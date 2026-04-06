import Link from "next/link";
import { signOutAction } from "@/app/actions/sign-out";
import { BalanceDisplay } from "@/components/balance-display";
import { ThemeToggle } from "@/components/theme-toggle";

export function TopNav({
  flashWordBalance,
  proWordBalance,
  workflowCredits,
  title,
  showBalance = true,
  showWritingToolsLink = true
}: {
  flashWordBalance?: number;
  proWordBalance?: number;
  workflowCredits?: number;
  title?: string;
  /** 为 false 时不在顶栏展示余额（例如仪表盘页内已有资产卡片） */
  showBalance?: boolean;
  /** 管理员后台等场景不展示「写作工具台」 */
  showWritingToolsLink?: boolean;
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Link href="/dashboard" className="shrink-0 font-semibold text-slate-900 dark:text-white">
            织梦AI小说
          </Link>
          {showWritingToolsLink ? (
            <>
              <Link
                href="/dashboard/writing-tools"
                className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-950/50 sm:px-2 sm:text-sm"
              >
                写作工具
              </Link>
              <Link
                href="/dashboard/knowledge"
                className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50 dark:text-teal-300 dark:hover:bg-teal-950/50 sm:px-2 sm:text-sm"
              >
                知识库
              </Link>
              <Link
                href="/dashboard/redeem"
                className="shrink-0 rounded-md px-1.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/50 sm:px-2 sm:text-sm"
              >
                激活码
              </Link>
            </>
          ) : null}
          {title ? (
            <span className="hidden text-sm text-slate-500 dark:text-slate-400 md:inline">/ {title}</span>
          ) : (
            <span className="hidden text-sm text-slate-400 dark:text-slate-500 md:inline">
              在纸间宇宙，写出你的理想世界。
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm">
          {showBalance &&
          typeof flashWordBalance === "number" &&
          typeof proWordBalance === "number" ? (
            <BalanceDisplay
              initialFlashWords={flashWordBalance}
              initialProWords={proWordBalance}
              initialWorkflowCredits={typeof workflowCredits === "number" ? workflowCredits : 0}
            />
          ) : null}
          <ThemeToggle />
          <form action={signOutAction}>
            <button className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700 dark:text-slate-200">
              退出
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
