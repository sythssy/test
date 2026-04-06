import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import { BalanceDisplay } from "@/components/balance-display";
import { EMPTY_TIPTAP_DOC } from "@/lib/chapter-content";
import Link from "next/link";
import { BookList } from "@/components/book-list";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";
import { PlatformUsageNotice } from "@/components/platform-usage-notice";
import { getWritingStatsAction, editBookAction } from "@/app/dashboard/actions";

export const metadata: Metadata = {
  title: "作品库",
  description: "管理作品、前往写作台与写作工具台；查看通行证资产与 AI 用量说明。"
};

async function createBook(formData: FormData) {
  "use server";
  const profile = await requireAuth();
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const supabase = createSupabaseServerClient();
  const { data: insertedBook } = await supabase
    .from("books")
    .insert({ user_id: profile.id, title, cover_url: "" })
    .select("id")
    .single();

  if (!insertedBook?.id) return;

  const { data: insertedChapter } = await supabase
    .from("chapters")
    .insert({
      book_id: insertedBook.id,
      title: "第1章",
      content: EMPTY_TIPTAP_DOC,
      word_count: 0,
      order_index: 1
    })
    .select("id")
    .single();

  revalidatePath("/dashboard");
  if (insertedChapter?.id) {
    redirect(`/editor/${insertedBook.id}/${insertedChapter.id}`);
  }
}

async function deleteBook(formData: FormData) {
  "use server";
  const profile = await requireAuth();
  const bookId = String(formData.get("bookId") ?? "").trim();
  if (!bookId) return;
  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", bookId)
    .single();
  if (!book || book.user_id !== profile.id) return;
  await supabase.from("books").delete().eq("id", bookId);
  revalidatePath("/dashboard");
}

export default async function DashboardPage() {
  const profile = await requireAuth();
  if (profile.role === "admin") {
    redirect("/admin");
  }

  const supabase = createSupabaseServerClient();
  const [{ data: books }, writingStats] = await Promise.all([
    supabase
      .from("books")
      .select("id,user_id,title,cover_url,description,genre,created_at,chapters(word_count)")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }),
    getWritingStatsAction()
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <TopNav showBalance={false} />
      <PlatformUsageNotice />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <section className="mb-6 rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50/80 to-white p-5 dark:border-indigo-900/40 dark:from-indigo-950/30 dark:to-slate-900">
          <h2 className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">通行证资产</h2>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            每次 AI 请求按模型返回的阅读+写作用量合并为字数额度，从所选 {BILLING_FLASH_BASE_WORDS_LABEL} / {BILLING_PRO_ADV_WORDS_LABEL} 池一次性扣减。{BILLING_WORKFLOW_CREDITS_SHORT} 预留给后续整链流程，与字数额度分开计算。
          </p>
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <BalanceDisplay
              initialFlashWords={profile.flash_word_balance}
              initialProWords={profile.pro_word_balance}
              initialWorkflowCredits={profile.workflow_credits ?? 0}
            />
            <div className="flex flex-col gap-2">
              <Link
                href="/dashboard/redeem"
                className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                激活码兑换 →
              </Link>
              <Link
                href="/dashboard/billing"
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                查看使用记录
              </Link>
            </div>
          </div>
        </section>

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">写作工具</h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                脑洞、书名、简介、大纲等生成入口已集中到工具台，便于按需选用。
              </p>
            </div>
            <Link
              href="/dashboard/writing-tools"
              className="inline-flex shrink-0 items-center justify-center rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
            >
              进入写作工具台
            </Link>
          </div>
        </section>

        {/* 今日写作统计条 */}
        {(writingStats.todayWords > 0 || writingStats.streak > 0) && (
          <section className="mb-6 flex flex-wrap items-center gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-3 dark:border-emerald-900/40 dark:from-emerald-950/30 dark:to-teal-950/30">
            {writingStats.todayWords > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xl">✍️</span>
                <div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">今日新增</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {writingStats.todayWords.toLocaleString()} 字
                  </p>
                </div>
              </div>
            )}
            {writingStats.streak > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xl">{writingStats.streak >= 7 ? "🔥" : "⚡"}</span>
                <div>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">连续创作</p>
                  <p className="text-lg font-bold tabular-nums text-emerald-800 dark:text-emerald-200">
                    {writingStats.streak} 天
                  </p>
                </div>
              </div>
            )}
            {writingStats.totalDays > 0 && (
              <p className="ml-auto text-xs text-emerald-500 dark:text-emerald-500">
                累计 {writingStats.totalDays} 个创作日
              </p>
            )}
          </section>
        )}

        <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
          <h1 className="text-xl font-semibold dark:text-white">作品库</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">在纸间宇宙，写出你的理想世界。</p>
          <form action={createBook} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              name="title"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring"
              placeholder="输入作品标题，例如：星河尽头的你"
            />
            <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white">
              + 新建作品
            </button>
          </form>
        </section>

        <BookList books={books ?? []} onDelete={deleteBook} onEdit={editBookAction} />
      </div>
    </main>
  );
}
