import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUserProfile, requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import { PlatformUsageNotice } from "@/components/platform-usage-notice";
import { EditorClient } from "@/components/editor/editor-client";
import { EditorErrorBoundary } from "@/components/editor/editor-error-boundary";
import { normalizeChapterContent } from "@/lib/chapter-content";
import type { JSONContent } from "@tiptap/core";

const editorFallbackMetadata: Metadata = {
  title: "编辑器",
  description: "章节编辑、AI 润色扩写去痕、聊天与脑洞等创作能力。"
};

export async function generateMetadata({
  params
}: {
  params: { bookId: string; chapterId: string };
}): Promise<Metadata> {
  const profile = await getCurrentUserProfile();
  if (!profile || profile.status === "banned") {
    return editorFallbackMetadata;
  }

  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase
    .from("books")
    .select("id,title,user_id")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    return editorFallbackMetadata;
  }

  const { data: chapter } = await supabase
    .from("chapters")
    .select("id,title,order_index")
    .eq("id", params.chapterId)
    .eq("book_id", params.bookId)
    .maybeSingle();

  if (!chapter) {
    return {
      ...editorFallbackMetadata,
      title: `《${book.title}》`
    };
  }

  const n = Number(chapter.order_index ?? 1);
  const title = `《${book.title}》· 第 ${n} 章`;
  const chapterLabel = (chapter.title ?? "").trim() || `第${n}章`;
  return {
    title,
    description: `《${book.title}》${chapterLabel}：正文编辑、润色扩写与聊天等。`
  };
}

export default async function EditorPage({
  params
}: {
  params: { bookId: string; chapterId: string };
}) {
  const profile = await requireAuth();
  if (profile.role === "admin") {
    redirect("/admin");
  }

  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase
    .from("books")
    .select("id,title,user_id,current_conversation_id,current_model_key")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    redirect("/dashboard");
  }

  const [{ data: chapters }, { data: activeModels }] = await Promise.all([
    supabase
      .from("chapters")
      .select("id,title,order_index,content,word_count,created_at")
      .eq("book_id", params.bookId)
      .order("order_index", { ascending: true }),
    supabase
      .from("ai_models")
      .select("model_key,name,action_type,word_pool")
      .eq("is_active", true)
      .order("sort_order")
  ]);

  if (!chapters?.length) {
    redirect(`/editor/${params.bookId}`);
  }

  const currentChapter = chapters.find((chapter) => chapter.id === params.chapterId);
  if (!currentChapter) {
    redirect(`/editor/${params.bookId}/${chapters[0].id}`);
  }

  const initialDoc = normalizeChapterContent(currentChapter.content);

  return (
    <main className="min-h-screen bg-slate-50">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title={book.title}
      />
      <PlatformUsageNotice />
      <EditorErrorBoundary>
      <EditorClient
        bookId={params.bookId}
        bookTitle={book.title}
        currentChapterId={params.chapterId}
        initialDoc={initialDoc as JSONContent}
        initialWordCount={currentChapter.word_count}
        initialConversationId={book.current_conversation_id ?? ""}
        currentModelKey={book.current_model_key ?? "default"}
        availableModels={activeModels ?? []}
        chapters={chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          order_index: chapter.order_index,
          word_count: chapter.word_count ?? 0,
          created_at: chapter.created_at ?? null
        }))}
      />
      </EditorErrorBoundary>
    </main>
  );
}
