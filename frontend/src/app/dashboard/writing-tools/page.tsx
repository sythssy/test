import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import { PlatformUsageNotice } from "@/components/platform-usage-notice";
import { WritingToolsClient } from "@/components/writing-tools-client";
import { WRITING_TOOL_DEFINITIONS } from "@/lib/writing-tools-config";

const WRITING_TOOLS_DEEP_LINK_IDS = new Set<string>([
  "brainstorm",
  ...WRITING_TOOL_DEFINITIONS.map((d) => d.id)
]);

export const metadata: Metadata = {
  title: "写作工具台",
  description:
    "书名、简介、大纲、细纲、脑洞、人设、世界观等 AI 生成器集中使用；按作品与所选模型字数池计费。"
};

export default async function WritingToolsPage({
  searchParams
}: {
  searchParams: { bookId?: string; tool?: string };
}) {
  const profile = await requireAuth();
  if (profile.role === "admin") {
    redirect("/admin");
  }

  const bookIdParam = searchParams.bookId;
  const initialBookId = (bookIdParam ?? "").trim() || null;
  const toolParam = (searchParams.tool ?? "").trim();
  const initialToolId =
    toolParam && WRITING_TOOLS_DEEP_LINK_IDS.has(toolParam) ? toolParam : null;

  const supabase = createSupabaseServerClient();
  const [{ data: books }, { data: activeModels }] = await Promise.all([
    supabase
      .from("books")
      .select("id,title,current_model_key")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("ai_models")
      .select("model_key,name,action_type,word_pool")
      .eq("is_active", true)
      .order("sort_order")
  ]);

  return (
    <main className="min-h-screen bg-slate-50">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title="写作工具台"
      />
      <PlatformUsageNotice />
      <div className="mx-auto max-w-6xl px-4 py-8">
        <nav className="mb-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link href="/dashboard" className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400">
            ← 返回作品库
          </Link>
          <Link
            href="/dashboard/knowledge"
            className="text-teal-800 underline hover:text-teal-950 dark:text-teal-300 dark:hover:text-teal-200"
          >
            知识库
          </Link>
        </nav>
        <header className="mb-8">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-white">写作工具台</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            将书名、脑洞、简介、大纲等生成能力集中在一处；先选择作品与模型，再点击对应卡片。分享链接可使用查询参数{" "}
            <span className="whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">bookId</span>、
            <span className="whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">tool</span>
            （与卡片 id 一致，例如 outline、title、brainstorm）。
          </p>
        </header>
        <WritingToolsClient
          books={books ?? []}
          availableModels={activeModels ?? []}
          initialBookId={initialBookId}
          initialToolId={initialToolId}
        />
      </div>
    </main>
  );
}
