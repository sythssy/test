import type { Metadata } from "next";
import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { TopNav } from "@/components/top-nav";
import { RedeemBox } from "@/components/redeem-box";
import { BalanceDisplay } from "@/components/balance-display";
import { ANNOUNCEMENTS, type Announcement } from "@/lib/announcements";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT,
  BILLING_FLASH_SHORT,
  BILLING_PRO_SHORT,
  BILLING_FLASH_DESC,
  BILLING_PRO_DESC
} from "@/lib/billing-labels";

export const metadata: Metadata = {
  title: "激活码兑换",
  description: "使用激活码兑换字数额度与工作流次数，查看最新功能更新公告。"
};

const TAG_STYLES: Record<Announcement["tag"], string> = {
  "功能更新":
    "bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800/60",
  "提示词优化":
    "bg-violet-50 text-violet-700 border border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800/60",
  "体验改进":
    "bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-800/60"
};

export default async function RedeemPage() {
  const profile = await requireAuth();

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title="激活码兑换"
      />

      <div className="mx-auto max-w-6xl px-4 py-8">

        {/* 返回 */}
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
          >
            ← 返回作品库
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

          {/* ── 左侧：兑换区（3/5） ── */}
          <section className="lg:col-span-3">
            <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white p-6 dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-slate-900">
              <h1 className="text-lg font-semibold text-indigo-900 dark:text-indigo-100">
                激活码兑换
              </h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                输入激活码后点击「立即兑换」，额度即时到账。一码一用，绑定当前账号，无法转让。
              </p>

              {/* 引擎说明 */}
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5 dark:border-indigo-900/40 dark:bg-indigo-950/30">
                  <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">{BILLING_FLASH_SHORT}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-indigo-700/80 dark:text-indigo-300/80">{BILLING_FLASH_DESC}</p>
                </div>
                <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3 py-2.5 dark:border-violet-900/40 dark:bg-violet-950/30">
                  <p className="text-xs font-semibold text-violet-800 dark:text-violet-200">{BILLING_PRO_SHORT}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-violet-700/80 dark:text-violet-300/80">{BILLING_PRO_DESC}</p>
                </div>
              </div>

              {/* 当前资产 */}
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-400">当前资产</p>
                <BalanceDisplay
                  initialFlashWords={profile.flash_word_balance}
                  initialProWords={profile.pro_word_balance}
                  initialWorkflowCredits={profile.workflow_credits ?? 0}
                />
              </div>

              {/* 兑换输入框 */}
              <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <RedeemBox shopUrl={process.env.NEXT_PUBLIC_CDK_SHOP_URL} />
              </div>

              {/* 说明 */}
              <div className="mt-4 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <p>
                  · 兑换成功后，{BILLING_FLASH_BASE_WORDS_LABEL}、{BILLING_PRO_ADV_WORDS_LABEL}
                  与{BILLING_WORKFLOW_CREDITS_SHORT}即时增加，刷新页面可见最新余额。
                </p>
                <p>· 每枚激活码仅可兑换一次，兑换后立即绑定当前账号，无法转移或退换。</p>
                <p>
                  · 字数使用明细可在{" "}
                  <Link href="/dashboard/billing" className="text-indigo-500 underline hover:text-indigo-700">
                    使用记录
                  </Link>{" "}
                  页查看。
                </p>
              </div>
            </div>
          </section>

          {/* ── 右侧：公告区（2/5） ── */}
          <aside className="lg:col-span-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                功能更新公告
              </h2>
              <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                功能迭代 · 提示词优化通知
              </p>

              <ul className="mt-4 space-y-4">
                {ANNOUNCEMENTS.map((a) => (
                  <li key={a.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${TAG_STYLES[a.tag]}`}
                      >
                        {a.tag}
                      </span>
                      <time className="text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
                        {a.date}
                      </time>
                    </div>
                    <p className="mt-1 text-xs font-medium text-slate-800 dark:text-slate-200">
                      {a.title}
                    </p>
                    {a.body ? (
                      <p className="mt-0.5 whitespace-pre-line text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        {a.body}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </aside>

        </div>
      </div>
    </main>
  );
}
