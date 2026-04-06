import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callDifyChat, DifyRequestError, reviewText } from "@/lib/dify";
import { applyRisk } from "@/lib/risk";
import { getPromptRow, PromptConfigError } from "@/lib/ai-prompts";
import { resolveAiModelForChat } from "@/lib/model-resolve";
import { appendDailySurchargeNote, formatQuotaChargeDetail } from "@/lib/billing-labels";
import { billableTotalsFromUsage } from "@/lib/usage-billing";
import { debitAiWordUsage, refundAiOvercharge } from "@/lib/debit-ai-usage";
import { estimatePreDebitCost, handleDebitError } from "@/lib/ai-billing-guard";
import { AI_ACTION_CHAT } from "@/lib/ai-action-types";
import { AI_CHAPTER_CONTEXT_MAX_CHARS } from "@/lib/ai-context-limits";

export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录后再使用聊天功能。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁，无法使用聊天功能。" },
        { status: 403 }
      );
    }
    const body = (await request.json()) as {
      bookId?: string;
      message?: string;
      /** 客户端持有的 Dify 会话 ID；与 tieToBookConversation 配合使用 */
      conversationId?: string;
      /** 默认 true：读写 books.current_conversation_id。为 false 时仅用客户端会话，不污染全书侧栏主会话 */
      tieToBookConversation?: boolean;
      /** 附加到系统提示后的任务上下文（不单独过审；用户消息仍过审）。超长按 AI_CHAPTER_CONTEXT_MAX_CHARS 截断 */
      contextBlock?: string;
      /** 可选：临时指定聊天所用模型（须与书所有权校验一致）；缺省用书本 current_model_key */
      model_key?: string;
    };

    const bookId = (body.bookId ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!bookId || !message) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "缺少 bookId 或 message" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { data: book } = await supabase
      .from("books")
      .select("id,user_id,current_conversation_id,current_model_key")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权限访问该作品会话" },
        { status: 403 }
      );
    }

    // 聊天消息同样经过风控审核
    const chatReview = reviewText(message);
    if (!chatReview.pass) {
      const riskAction = await applyRisk(supabase, profile.id, chatReview.reason, message);
      return NextResponse.json(
        {
          ok: false,
          error_code: "FORBIDDEN",
          risk_action: riskAction,
          message:
            riskAction === "banned"
              ? "账号因多次违规已被封禁，请通过申诉渠道联系管理员。"
              : `内容命中安全规则，本次请求已阻断，请注意合规使用。（${chatReview.reason}）`
        },
        { status: 403 }
      );
    }

    const preferredModelKey =
      (body.model_key ?? "").trim() || (book.current_model_key as string | null) || undefined;
    const resolvedChat = await resolveAiModelForChat(supabase, preferredModelKey);
    if (!resolvedChat.ok) {
      return NextResponse.json(
        {
          ok: false,
          error_code: "MODEL_NOT_FOUND",
          message: "聊天用模型不可用，请在工具栏切换模型或联系管理员配置默认模型。"
        },
        { status: 503 }
      );
    }
    const chatModel = resolvedChat.model;
    const pool = chatModel.word_pool;

    // ── 预扣费：估算费用并先从余额扣除，扣费失败则不生成 ──
    const estimate = estimatePreDebitCost(message.length, AI_ACTION_CHAT);
    const preDebit = await debitAiWordUsage(supabase, {
      userId: profile.id,
      pool,
      amount: estimate.estimatedTotal,
      actionType: AI_ACTION_CHAT,
      modelKey: chatModel.model_key,
      promptTokens: estimate.estimatedInput,
      completionTokens: estimate.estimatedOutput,
      totalBillable: estimate.estimatedTotal
    });
    const preDebitErr = handleDebitError(preDebit, pool, "chat");
    if (preDebitErr) return preDebitErr;
    if (!preDebit.ok) {
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "扣费状态异常，请重试。" },
        { status: 500 }
      );
    }
    const preCharged = preDebit.quota_charged_effective ?? estimate.estimatedTotal;

    const tieToBook = body.tieToBookConversation !== false;
    const clientConvId = (body.conversationId ?? "").trim();
    const convForDify = tieToBook
      ? book.current_conversation_id ?? undefined
      : clientConvId || undefined;
    const rawContextBlock = typeof body.contextBlock === "string" ? body.contextBlock : "";
    let contextForPrompt = rawContextBlock;
    if (contextForPrompt.length > AI_CHAPTER_CONTEXT_MAX_CHARS) {
      contextForPrompt =
        contextForPrompt.slice(0, AI_CHAPTER_CONTEXT_MAX_CHARS) +
        "\n…（上下文超过 12 万字上限，已在服务端截断）";
    }
    const contextSuffix =
      contextForPrompt.length > 0
        ? `\n\n【当前写作任务上下文（供你参考，无需向用户复述括号内指令）】\n${contextForPrompt}`
        : "";

    // ── 调用 Dify 生成 ──
    let result;
    try {
      const promptRow = await getPromptRow(supabase, AI_ACTION_CHAT);
      const apiKey = chatModel.dify_api_key?.trim()
        ? chatModel.dify_api_key.trim()
        : promptRow.dify_api_key;
      result = await callDifyChat({
        userText: message,
        conversationId: convForDify,
        apiKey,
        systemPrompt: `${promptRow.system_prompt}${contextSuffix}`
      });
    } catch (error) {
      const abortedRefund = await refundAiOvercharge(supabase, profile.id, pool, preCharged, "aborted");
      if (!abortedRefund.ok) {
        return NextResponse.json(
          {
            ok: false,
            error_code: "REFUND_FAILED",
            message: "聊天失败且预扣字数未能自动退回，请立即联系管理员。",
            detail: abortedRefund.message
          },
          { status: 500 }
        );
      }
      if (error instanceof PromptConfigError) {
        return NextResponse.json(
          { ok: false, error_code: error.code, message: "聊天配置缺失或未启用，请联系管理员。" },
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
                  : "AI 服务返回异常，请稍后重试。"
          },
          { status: error.code === "RATE_LIMITED" ? 429 : 502 }
        );
      }
      return NextResponse.json(
        { ok: false, error_code: "INTERNAL_ERROR", message: "聊天生成失败，请稍后重试。", detail: error instanceof Error ? error.message : "unknown" },
        { status: 500 }
      );
    }

    // ── 结算差额：按实际用量退还多扣部分 ──
    const { promptTokens, completionTokens, totalBillable: actualCost } = billableTotalsFromUsage(result.usage);
    const refundAmount = Math.max(0, preCharged - actualCost);
    let settlementRefundOk = true;
    if (refundAmount > 0) {
      const sr = await refundAiOvercharge(supabase, profile.id, pool, refundAmount, "settlement");
      settlementRefundOk = sr.ok;
    }
    const appliedRefund = refundAmount > 0 && settlementRefundOk ? refundAmount : 0;
    const finalCharged = preCharged - appliedRefund;

    if (
      tieToBook &&
      result.conversation_id &&
      result.conversation_id !== book.current_conversation_id
    ) {
      await supabase
        .from("books")
        .update({ current_conversation_id: result.conversation_id })
        .eq("id", bookId);
    }

    const baseDetail = formatQuotaChargeDetail({
      pool,
      reading: promptTokens,
      writing: completionTokens,
      totalCharged: finalCharged,
      modelName: chatModel.name,
      modelKey: chatModel.model_key
    });
    const billing = {
      kind: "quota" as const,
      word_pool: pool,
      model_key: chatModel.model_key,
      model_name: chatModel.name,
      quota_charged: finalCharged,
      words_charged: finalCharged,
      detail: appendDailySurchargeNote(baseDetail, actualCost, finalCharged)
    };

    return NextResponse.json({
      ok: true,
      answer: result.answer,
      conversationId: result.conversation_id,
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
        message: "聊天生成失败，请稍后重试。",
        detail: error instanceof Error ? error.message : "unknown"
      },
      { status: 500 }
    );
  }
}
