import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import { PlatformUsageNotice } from "@/components/platform-usage-notice";
import { KnowledgeLibraryClient } from "@/components/knowledge-library-client";

export const metadata: Metadata = {
  title: "知识库",
  description: "按作品查看、复制或删除已入库的脑洞与素材条目。"
};

export default async function KnowledgePage({
  searchParams
}: {
  searchParams: { bookId?: string };
}) {
  const profile = await requireAuth();
  if (profile.role === "admin") {
    redirect("/admin");
  }

  const bookIdParam = (searchParams.bookId ?? "").trim() || null;

  const supabase = createSupabaseServerClient();
  const { data: books } = await supabase
    .from("books")
    .select("id,title")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title="知识库"
      />
      <PlatformUsageNotice />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <nav className="mb-4 text-sm">
          <Link
            href="/dashboard"
            className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
          >
            ← 返回作品库
          </Link>
        </nav>
        <header className="mb-8">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">知识库</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            查看本书已保存的脑洞与素材；可从编辑器「加入知识库」写入。支持按作品筛选、复制正文与删除。
          </p>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            深链可带{" "}
            <span className="font-mono text-[11px]">bookId</span> 查询参数以打开指定作品。
          </p>
        </header>
        <KnowledgeLibraryClient books={books ?? []} initialBookId={bookIdParam} />
      </div>
    </main>
  );
}
