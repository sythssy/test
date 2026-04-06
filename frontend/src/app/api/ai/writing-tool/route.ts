import { NextResponse } from "next/server";
import { callDifyChat, DifyRequestError, reviewText } from "@/lib/dify";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";
import { applyRisk } from "@/lib/risk";
import { getPromptRow, PromptConfigError } from "@/lib/ai-prompts";
import { resolveAiModelForWritingTool } from "@/lib/model-resolve";
import { appendDailySurchargeNote, formatQuotaChargeDetail } from "@/lib/billing-labels";
import { billableTotalsFromUsage } from "@/lib/usage-billing";
import { debitAiWordUsage, refundAiOvercharge, debitWorkflowInvocation, refundWorkflowCredit } from "@/lib/debit-ai-usage";
import { estimatePreDebitCost, handleDebitError, handleWorkflowDebitError } from "@/lib/ai-billing-guard";
import { getWritingToolDefinition } from "@/lib/writing-tools-config";

/**
 * 工具台通用生成：与脑洞大纲相同计费规则（字数池、日封顶等），action_type 随工具变化。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再使用写作工具。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      tool?: string;
      bookId?: string;
      model_key?: string;
      fields?: Record<string, string>;
    };

    const toolIdRaw = (body.tool ?? "").trim();
    const def = getWritingToolDefinition(toolIdRaw);
    if (!def) {
      return NextResponse.json(
        { ok: false, error_code: "BAD_REQUEST", message: "不支持的写作工具类型。" },
        { status: 400 }
      );
    }

    const bookId = (body.bookId ?? "").trim();
    if (!bookId) {
      return NextResponse.json({ ok: false, error_code: "BAD_REQUEST", message: "缺少 bookId" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: book } = await supabase
      .from("books")
      .select("id,user_id,title")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权限访问该作品。" },
        { status: 403 }
      );
    }

    const rawFields = body.fields ?? {};
    const values: Record<string, string> = {};
    for (const spec of def.fields) {
      const v = String(rawFields[spec.key] ?? "").trim();
      if (!v && !spec.optional) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "BAD_REQUEST",
            message: `请填写「${spec.label}」。`
          },
          { status: 400 }
        );
      }
      values[spec.key] = v;
    }

    const userText = def.buildUserText(book.title, values);

    const review = reviewText(userText);
    if (!review.pass) {
      const riskAction = await applyRisk(supabase, profile.id, review.reason, userText);
      return NextResponse.json(
        {
          ok: false,
          error_code: "FORBIDDEN",
          risk_action: riskAction,
          message:
            riskAction === "banned"
              ? "账号因多次违规已被封禁，请通过申诉渠道联系管理员。"
              : `内容命中安全规则，本次请求已阻断。（${review.reason}）`
        },
        { status: 403 }
      );
    }

    const modelKeyReq = (body.model_key ?? "").trim() || "default";
    const resolvedModel = await resolveAiModelForWritingTool(supabase, modelKeyReq, def.actionType);
    if (!resolvedModel.ok) {
      if (resolvedModel.code === "MODEL_ACTION_MISMATCH") {
        return NextResponse.json(
          {
            ok: false,
            error_code: "MODEL_ACTION_MISMATCH",
            message:
              "所选模型专用于其他能力，且未找到可用的写作工具回退模型。请在后台配置 writing_tools_default 或通用 default。"
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error_code: "MODEL_NOT_FOUND",
          message:
            "无可用模型，请联系管理员为该工具配置绑定了对应 action_type 的模型，或配置 writing_tools_default / default。"
        },
        { status: 503 }
      );
    }

    const modelRow = resolvedModel.model;
    const pool = modelRow.word_pool;

    // ── 预扣费（字数）：估算费用并先从余额扣除，扣费失败则不生成 ──
    const estimate = estimatePreDebitCost(userText.length, def.actionType);
    const preDebit = await debitAiWordUsage(supabase, {
      userId: profile.id,
      pool,
      amount: estimate.estimatedTotal,
      actionType: def.actionType,
      modelKey: modelRow.model_key,
      promptTokens: estimate.estimatedInput,
      completionTokens: estimate.estimatedOutput,
      totalBillable: estimate.estimatedTotal
    });
    const preDebitErr = handleDebitError(preDebit, pool, "writing_tool");
    if (preDebitErr) return preDebitErr;
    if (!preDebit.ok) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "扣费状态异常，请重试。" },
        { status: 500 }
      );
    }
    const preCharged = preDebit.quota_charged_effective ?? estimate.estimatedTotal;

    // ── 预扣费（工作流次数）：写作工具每次调用额外消耗 1 次 ──
    let wfDebited = false;
    if (estimate.costsWorkflowCredit) {
      const wfDebit = await debitWorkflowInvocation(supabase, profile.id, def.actionType);
      const wfErr = handleWorkflowDebitError(wfDebit);
      if (wfErr) {
        const wr = await refundAiOvercharge(supabase, profile.id, pool, preCharged, "aborted");
        if (!wr.ok) {
          return NextResponse.json(
            {
              ok: false,
              error_code: "REFUND_FAILED",
              message: "工作流扣费未通过，且预扣字数未能自动退回，请立即联系管理员。",
              detail: wr.message
            },
            { status: 500 }
          );
        }
        return wfErr;
      }
      wfDebited = true;
    }

    // ── 调用 Dify 生成 ──
    let result;
    try {
      const promptRow = await getPromptRow(supabase, def.actionType);
      const apiKey = modelRow.dify_api_key?.trim()
        ? modelRow.dify_api_key.trim()
        : promptRow.dify_api_key;
      result = await callDifyChat({
        userText,
        apiKey,
        systemPrompt: promptRow.system_prompt
      });
    } catch (error) {
      const abortedWord = await refundAiOvercharge(supabase, profile.id, pool, preCharged, "aborted");
      if (!abortedWord.ok) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "REFUND_FAILED",
            message: "生成失败且预扣字数未能自动退回，请立即联系管理员。",
            detail: abortedWord.message
          },
          { status: 500 }
        );
      }
      if (wfDebited) {
        const wfr = await refundWorkflowCredit(supabase, profile.id);
        if (!wfr.ok) {
          return NextResponse.json(
            {
              ok: false,
              error_code: "REFUND_FAILED",
              message: "字数已退回，但工作流次数未能自动退回，请联系管理员。",
              detail: wfr.message
            },
            { status: 500 }
          );
        }
      }
      if (error instanceof PromptConfigError) {
        return NextResponse.json(
          { ok: false, error_code: error.code, message: "该生成器未在后台配置或未启用，请联系管理员。" },
          { status: 503 }
        );
      }
      if (error instanceof DifyRequestError) {
        return NextResponse.json(
          {
            ok: false,
            error_code: error.code,
            message:
              error.code === "RATE_LIMITED"
                ? "服务限流中，请稍后重试。"
                : error.code === "DIFY_TIMEOUT"
                  ? "AI 响应超时，请稍后重试。"
                  : "AI 服务返回异常，请稍后重试。",
            detail: error.message
          },
          { status: error.code === "RATE_LIMITED" ? 429 : 502 }
        );
      }
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "写作工具生成失败，请稍后重试。", detail: error instanceof Error ? error.message : "unknown" },
        { status: 500 }
      );
    }

    // ── 结算差额：按实际用量退还多扣部分（工作流次数固定 1 次不退差） ──
    const { promptTokens, completionTokens, totalBillable: actualCost } = billableTotalsFromUsage(result.usage);
    const refundAmount = Math.max(0, preCharged - actualCost);
    let settlementRefundOk = true;
    if (refundAmount > 0) {
      const sr = await refundAiOvercharge(supabase, profile.id, pool, refundAmount, "settlement");
      settlementRefundOk = sr.ok;
    }
    const appliedRefund = refundAmount > 0 && settlementRefundOk ? refundAmount : 0;
    const finalCharged = preCharged - appliedRefund;

    const baseDetail = formatQuotaChargeDetail({
      pool,
      reading: promptTokens,
      writing: completionTokens,
      totalCharged: finalCharged,
      modelName: modelRow.name,
      modelKey: modelRow.model_key
    });
    const billing = {
      kind: "quota" as const,
      word_pool: pool,
      model_key: modelRow.model_key,
      model_name: modelRow.name,
      quota_charged: finalCharged,
      words_charged: finalCharged,
      detail: appendDailySurchargeNote(baseDetail, actualCost, finalCharged)
    };

    return NextResponse.json({
      ok: true,
      answer: result.answer,
      usage: {
        reading: promptTokens,
        writing: completionTokens,
        total_charged: finalCharged
      },
      billing,
      ...(refundAmount > 0 && !settlementRefundOk
        ? {
            settlement_refund_failed: true as const,
            settlement_refund_detail: "差额退回未生效，请联系管理员核对余额。"
          }
        : {}),
      flash_word_balance: preDebit.flash_word_balance + (pool === "flash" ? appliedRefund : 0),
      pro_word_balance: preDebit.pro_word_balance + (pool === "pro" ? appliedRefund : 0)
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "INTERNAL_ERROR",
        message: "写作工具生成失败，请稍后重试。",
        detail: error instanceof Error ? error.message : "unknown"
      },
      { status: 500 }
    );
  }
}
