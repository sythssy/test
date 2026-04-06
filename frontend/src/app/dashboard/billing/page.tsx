import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import {
  AI_ACTION_WELFARE_CREDIT,
  AI_ACTION_WORD_REFUND_ABORTED,
  AI_ACTION_WORD_REFUND_SETTLEMENT
} from "@/lib/ai-action-types";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_FLASH_SHORT,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_PRO_SHORT,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

export const metadata: Metadata = {
  title: "使用记录",
  description: "查看字数使用明细与工作流次数使用明细。"
};

/** 友好展示 action_type */
function actionLabel(actionType: string, isCredit: boolean): string {
  if (isCredit) return "激活码 / 福利入账";
  const map: Record<string, string> = {
    [AI_ACTION_WORD_REFUND_SETTLEMENT]: "预扣结算退还",
    [AI_ACTION_WORD_REFUND_ABORTED]: "生成失败退还",
    brainstorm_outline: "脑洞生成",
    chat: "侧栏聊天",
    polish: "润色",
    expand: "扩写",
    de_ai: "去 AI 痕迹",
    paragraph_verify: "段落查证",
    book_title: "书名生成",
    book_blurb: "简介生成",
    book_outline: "大纲生成",
    fine_outline: "细纲生成",
    golden_opening: "黄金开篇",
    golden_finger: "主角金手指",
    name_gen: "角色取名",
    character_setting: "角色设定",
    worldview: "世界观",
    glossary_entry: "词条生成",
    cover_copy: "封面文案"
  };
  return map[actionType] ?? actionType;
}

export default async function UserBillingPage() {
  const profile = await requireAuth();

  if (profile.role === "admin") {
    return (
      <main className="min-h-screen bg-slate-50">
        <TopNav
          flashWordBalance={profile.flash_word_balance}
          proWordBalance={profile.pro_word_balance}
          workflowCredits={profile.workflow_credits ?? 0}
          title="使用记录"
        />
        <div className="mx-auto max-w-6xl px-4 py-8">
          <p className="text-sm text-slate-600">
            管理员请使用后台查看全站明细。
            <Link href="/admin" className="ml-2 text-indigo-600 underline">
              前往后台
            </Link>
          </p>
        </div>
      </main>
    );
  }

  const supabase = createSupabaseServerClient();
  const { data: logs } = await supabase
    .from("billing_logs")
    .select(
      "id,cost_words,cost_workflow_credits,action_type,model_key,word_pool,input_tokens,output_tokens,total_tokens,created_at,flash_credit,pro_credit"
    )
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(500);

  // 字数相关行：AI 扣减 + 退还（cost_words 可为负）+ 福利入账
  const wordLogs = (logs ?? []).filter(
    (r) =>
      Number(r.cost_words ?? 0) !== 0 ||
      Number(r.flash_credit ?? 0) > 0 ||
      Number(r.pro_credit ?? 0) > 0
  );

  const workflowLogs = (logs ?? []).filter(
    (r) => Number(r.cost_workflow_credits ?? 0) > 0
  );

  return (
    <main className="min-h-screen bg-slate-50">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title="使用记录"
      />
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-8">

        {/* 返回 */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">使用记录</h1>
          <Link
            href="/dashboard"
            className="text-sm text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
          >
            ← 返回作品库
          </Link>
        </div>

        {/* ── 字数使用记录 ── */}
        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800 dark:text-white">字数使用记录</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              每次 AI 调用按阅读 + 写作用量合并扣减；「预扣结算退还」为实际用量小于预扣时的退回；「生成失败退还」为未成功生成时的预扣退回。入账行来自激活码兑换与运营福利。
              当前余额：{BILLING_FLASH_BASE_WORDS_LABEL}&nbsp;
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {profile.flash_word_balance.toLocaleString()}
              </span>
              &nbsp;字 ·&nbsp;{BILLING_PRO_ADV_WORDS_LABEL}&nbsp;
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {profile.pro_word_balance.toLocaleString()}
              </span>
              &nbsp;字
            </p>
          </div>

          {!wordLogs.length ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              暂无字数使用记录。
            </p>
          ) : (
            <div className="max-h-[min(60vh,32rem)] overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">时间</th>
                    <th className="px-3 py-2">操作类型</th>
                    <th className="px-3 py-2">模型</th>
                    <th className="whitespace-nowrap px-3 py-2">扣减 / 退还</th>
                  <th className="whitespace-nowrap px-3 py-2">极速引擎入账</th>
                  <th className="whitespace-nowrap px-3 py-2">深度引擎入账</th>
                  </tr>
                </thead>
                <tbody>
                  {wordLogs.map((r) => {
                    const isCredit = r.action_type === AI_ACTION_WELFARE_CREDIT;
                    const deducted = Number(r.cost_words ?? 0);
                    const isRefund =
                      deducted < 0 ||
                      r.action_type === AI_ACTION_WORD_REFUND_SETTLEMENT ||
                      r.action_type === AI_ACTION_WORD_REFUND_ABORTED;
                    const fc = Number(r.flash_credit ?? 0);
                    const pc = Number(r.pro_credit ?? 0);
                    const poolShort =
                      r.word_pool === "pro"
                        ? BILLING_PRO_SHORT
                        : r.word_pool === "flash"
                          ? BILLING_FLASH_SHORT
                          : null;
                    return (
                      <tr
                        key={r.id}
                        className={`border-b border-slate-50 last:border-0 dark:border-slate-800 ${
                          isCredit
                            ? "bg-emerald-50/40 dark:bg-emerald-950/20"
                            : isRefund
                              ? "bg-sky-50/50 dark:bg-sky-950/20"
                              : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">
                          {new Date(r.created_at).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
                          {actionLabel(r.action_type, isCredit)}
                        </td>
                        <td className="max-w-[9rem] truncate px-3 py-2 text-slate-500 dark:text-slate-400">
                          {isRefund ? (poolShort ?? "—") : r.model_key ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                          {isCredit || deducted === 0 ? (
                            "—"
                          ) : isRefund ? (
                            <span className="font-medium text-emerald-700 dark:text-emerald-400">
                              +{Math.abs(deducted).toLocaleString()} 字
                            </span>
                          ) : (
                            <span className="text-rose-700 dark:text-rose-400">
                              −{deducted.toLocaleString()}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {fc > 0 ? `+${fc.toLocaleString()}` : "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {pc > 0 ? `+${pc.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── 工作流次数使用记录 ── */}
        <section>
          <div className="mb-3">
            <h2 className="text-base font-semibold text-slate-800 dark:text-white">
              {BILLING_WORKFLOW_CREDITS_SHORT}使用记录
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              整链创作工作流每次调用消耗一次次数，与字数额度独立计算。
              当前余额：
              <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {(profile.workflow_credits ?? 0).toLocaleString()}
              </span>
              &nbsp;次
            </p>
          </div>

          {!workflowLogs.length ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900">
              暂无工作流使用记录。工作流功能启用后，每次调用明细将在此展示。
            </p>
          ) : (
            <div className="max-h-[min(40vh,24rem)] overflow-auto rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
              <table className="min-w-full text-left text-xs">
                <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2">时间</th>
                    <th className="px-3 py-2">工作流名称</th>
                    <th className="whitespace-nowrap px-3 py-2">扣减次数</th>
                  </tr>
                </thead>
                <tbody>
                  {workflowLogs.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 last:border-0 dark:border-slate-800">
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                      <td className="px-3 py-2 text-slate-700">{r.action_type}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-rose-700">−1</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
