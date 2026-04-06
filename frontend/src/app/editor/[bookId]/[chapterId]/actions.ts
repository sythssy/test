"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  EMPTY_TIPTAP_DOC,
  sanitizeFilenameSegment,
  tiptapDocToPlainText,
  tiptapDocToMarkdown
} from "@/lib/chapter-content";
import { bookPartsToDocxBase64 } from "@/lib/export-docx";

export async function createChapterAction(
  bookId: string,
  currentChapterCount: number
) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    return { error: "无权限创建章节" };
  }

  const nextOrder = currentChapterCount + 1;
  const { data: chapter, error } = await supabase
    .from("chapters")
    .insert({
      book_id: bookId,
      title: `第${nextOrder}章`,
      content: EMPTY_TIPTAP_DOC,
      word_count: 0,
      order_index: nextOrder
    })
    .select("id")
    .single();

  if (error || !chapter?.id) {
    return { error: "创建章节失败" };
  }

  revalidatePath(`/editor/${bookId}/${chapter.id}`);
  return { chapterId: chapter.id };
}

export async function saveChapterAction(params: {
  bookId: string;
  chapterId: string;
  content: unknown;
  wordCount: number;
}) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: chapter } = await supabase
    .from("chapters")
    .select("id,book_id,word_count")
    .eq("id", params.chapterId)
    .eq("book_id", params.bookId)
    .single();

  if (!chapter) {
    return { ok: false, error: "无权限保存" };
  }

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", chapter.book_id)
    .single();

  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限保存" };
  }

  const safeWordCount = Number.isFinite(params.wordCount) ? Math.max(0, params.wordCount) : 0;
  const { error } = await supabase
    .from("chapters")
    .update({
      content: params.content ?? EMPTY_TIPTAP_DOC,
      word_count: safeWordCount
    })
    .eq("id", params.chapterId);

  if (error) {
    return { ok: false, error: "保存失败" };
  }

  // 记录今日写作字数增量（字数只统计增加，不计减少）
  const delta = safeWordCount - (chapter.word_count ?? 0);
  if (delta > 0) {
    // 按 Asia/Shanghai 时区取今日日期
    const todayStr = new Date()
      .toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }); // "YYYY-MM-DD"
    const { error: statErr } = await supabase.rpc("upsert_daily_writing_stat", {
      p_user_id:   profile.id,
      p_stat_date: todayStr,
      p_delta:     delta
    });
    if (statErr) {
      console.error("[saveChapterAction] upsert_daily_writing_stat:", statErr.message);
    }
  }

  revalidatePath(`/editor/${params.bookId}/${params.chapterId}`);
  return { ok: true, wordCount: safeWordCount };
}

export async function renameChapterAction(params: {
  bookId: string;
  chapterId: string;
  title: string;
}) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限重命名" };
  }

  const title = params.title.trim().slice(0, 100);
  if (!title) return { ok: false, error: "章节名不能为空" };

  const { error } = await supabase
    .from("chapters")
    .update({ title })
    .eq("id", params.chapterId)
    .eq("book_id", params.bookId);

  if (error) return { ok: false, error: "重命名失败" };

  revalidatePath(`/editor/${params.bookId}/${params.chapterId}`);
  return { ok: true, title };
}

export async function saveBookModelKeyAction(params: {
  bookId: string;
  modelKey: string;
}) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", params.bookId)
    .single();
  if (!book || book.user_id !== profile.id) return { ok: false };
  const { error } = await supabase.from("books").update({ current_model_key: params.modelKey }).eq("id", params.bookId);
  return { ok: !error };
}

export async function deleteChapterAction(params: {
  bookId: string;
  chapterId: string;
}) {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限删除" };
  }

  const { count } = await supabase
    .from("chapters")
    .select("id", { count: "exact", head: true })
    .eq("book_id", params.bookId);

  if ((count ?? 0) <= 1) {
    return { ok: false, error: "至少保留一个章节" };
  }

  const { error } = await supabase
    .from("chapters")
    .delete()
    .eq("id", params.chapterId)
    .eq("book_id", params.bookId);

  if (error) return { ok: false, error: "删除失败" };

  const { data: firstChapter } = await supabase
    .from("chapters")
    .select("id")
    .eq("book_id", params.bookId)
    .order("order_index", { ascending: true })
    .limit(1)
    .single();

  revalidatePath(`/editor/${params.bookId}/${params.chapterId}`);
  return { ok: true, redirectChapterId: firstChapter?.id ?? null };
}

/** 导出全书纯文本（数据库已保存内容，按章节顺序） */
export async function exportFullBookPlainTextAction(bookId: string): Promise<
  | { ok: true; text: string; filename: string }
  | { ok: false; error: string }
> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase.from("books").select("title,user_id").eq("id", bookId).single();
  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限导出该作品" };
  }

  const { data: chapters, error } = await supabase
    .from("chapters")
    .select("title,order_index,content")
    .eq("book_id", bookId)
    .order("order_index", { ascending: true });

  if (error || !chapters?.length) {
    return { ok: false, error: "没有可导出的章节" };
  }

  const titleLine = `《${book.title}》`;
  const parts: string[] = [titleLine, ""];
  for (const ch of chapters) {
    parts.push(`【${ch.title}】`, tiptapDocToPlainText(ch.content), "");
  }
  const text = parts.join("\n").trim();
  const day = new Date().toISOString().slice(0, 10);
  const safeBook = sanitizeFilenameSegment(book.title);
  return {
    ok: true,
    text,
    filename: `${safeBook}_全书_${day}.txt`
  };
}

/** 导出全书 Markdown（数据库已保存各章） */
export async function exportFullBookMarkdownAction(bookId: string): Promise<
  | { ok: true; text: string; filename: string }
  | { ok: false; error: string }
> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase.from("books").select("title,user_id").eq("id", bookId).single();
  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限导出该作品" };
  }

  const { data: chapters, error } = await supabase
    .from("chapters")
    .select("title,order_index,content")
    .eq("book_id", bookId)
    .order("order_index", { ascending: true });

  if (error || !chapters?.length) {
    return { ok: false, error: "没有可导出的章节" };
  }

  const parts: string[] = [`# 《${book.title}》`, ""];
  for (const ch of chapters) {
    parts.push(`## ${ch.title}`, "", tiptapDocToMarkdown(ch.content), "");
  }
  const text = parts.join("\n").trim();
  const day = new Date().toISOString().slice(0, 10);
  const safeBook = sanitizeFilenameSegment(book.title);
  return { ok: true, text, filename: `${safeBook}_全书_${day}.md` };
}

/** 导出全书 Word（数据库已保存各章） */
export async function exportFullBookDocxAction(bookId: string): Promise<
  | { ok: true; base64: string; filename: string }
  | { ok: false; error: string }
> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase.from("books").select("title,user_id").eq("id", bookId).single();
  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限导出该作品" };
  }

  const { data: chapters, error } = await supabase
    .from("chapters")
    .select("title,order_index,content")
    .eq("book_id", bookId)
    .order("order_index", { ascending: true });

  if (error || !chapters?.length) {
    return { ok: false, error: "没有可导出的章节" };
  }

  const parts = chapters.map((ch) => ({
    title: ch.title,
    body: tiptapDocToPlainText(ch.content)
  }));
  const base64 = await bookPartsToDocxBase64(`《${book.title}》`, parts);
  const day = new Date().toISOString().slice(0, 10);
  const safeBook = sanitizeFilenameSegment(book.title);
  return { ok: true, base64, filename: `${safeBook}_全书_${day}.docx` };
}

/** 单章 Word（可传当前编辑器 JSON，含未保存） */
export async function exportChapterDocxFromEditorAction(params: {
  bookId: string;
  bookTitle: string;
  chapterTitle: string;
  content: unknown;
}): Promise<{ ok: true; base64: string; filename: string } | { ok: false; error: string }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase.from("books").select("user_id").eq("id", params.bookId).single();
  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限导出" };
  }
  const body = tiptapDocToPlainText(params.content);
  const base64 = await bookPartsToDocxBase64(`《${params.bookTitle}》`, [
    { title: params.chapterTitle, body }
  ]);
  const day = new Date().toISOString().slice(0, 10);
  const safeCh = sanitizeFilenameSegment(params.chapterTitle);
  return { ok: true, base64, filename: `${safeCh}_${day}.docx` };
}

// ── 章节历史快照 ──────────────────────────────────────────────────────────────

export interface ChapterSnapshotMeta {
  id: string;
  label: string | null;
  word_count: number;
  created_at: string;
}

/**
 * 创建当前章节快照（fire-and-forget 可以不 await）。
 * 保留策略：30 天内的快照全部保留，30 天外的自动清理；
 * 同时每章最多保留 50 条（硬上限，防止单章无限增长）。
 */
export async function createChapterSnapshotAction(params: {
  bookId: string;
  chapterId: string;
  content: unknown;
  wordCount: number;
  label?: string;
}): Promise<{ ok: boolean }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("user_id")
    .eq("id", params.bookId)
    .single();
  if (!book || book.user_id !== profile.id) return { ok: false };

  const { error: insertErr } = await supabase.from("chapter_snapshots").insert({
    chapter_id: params.chapterId,
    book_id:    params.bookId,
    user_id:    profile.id,
    label:      params.label?.trim() || null,
    content:    params.content,
    word_count: params.wordCount
  });

  if (insertErr) return { ok: false };

  // 1. 删除 30 天前的快照
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from("chapter_snapshots")
    .delete()
    .eq("chapter_id", params.chapterId)
    .lt("created_at", cutoff);

  // 2. 如果 30 天内的快照仍超过 50 条，删除最旧的多余部分
  const { data: overflow } = await supabase
    .from("chapter_snapshots")
    .select("id")
    .eq("chapter_id", params.chapterId)
    .order("created_at", { ascending: false })
    .range(50, 9999);
  if (overflow?.length) {
    await supabase
      .from("chapter_snapshots")
      .delete()
      .in("id", overflow.map((s: { id: string }) => s.id));
  }

  return { ok: true };
}

/** 列出某章节的所有快照（元数据，不含内容）。 */
export async function listChapterSnapshotsAction(params: {
  bookId: string;
  chapterId: string;
}): Promise<{ ok: boolean; snapshots: ChapterSnapshotMeta[] }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("user_id")
    .eq("id", params.bookId)
    .single();
  if (!book || book.user_id !== profile.id) return { ok: false, snapshots: [] };

  const { data } = await supabase
    .from("chapter_snapshots")
    .select("id,label,word_count,created_at")
    .eq("chapter_id", params.chapterId)
    .order("created_at", { ascending: false })
    .limit(50);

  return { ok: true, snapshots: (data ?? []) as ChapterSnapshotMeta[] };
}

/** 恢复某条快照：返回快照内容，由前端写入编辑器，不直接覆盖数据库。 */
export async function restoreChapterSnapshotAction(params: {
  bookId: string;
  chapterId: string;
  snapshotId: string;
}): Promise<{ ok: boolean; content?: unknown; wordCount?: number }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("user_id")
    .eq("id", params.bookId)
    .single();
  if (!book || book.user_id !== profile.id) return { ok: false };

  const { data: snap } = await supabase
    .from("chapter_snapshots")
    .select("content,word_count")
    .eq("id", params.snapshotId)
    .eq("chapter_id", params.chapterId)
    .single();

  if (!snap) return { ok: false };
  return { ok: true, content: snap.content, wordCount: snap.word_count };
}

/** 删除单条快照。 */
export async function deleteChapterSnapshotAction(params: {
  snapshotId: string;
}): Promise<{ ok: boolean }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { error } = await supabase
    .from("chapter_snapshots")
    .delete()
    .eq("id", params.snapshotId)
    .eq("user_id", profile.id);

  return { ok: !error };
}

/**
 * 批量更新章节排序。orderedIds 为按新顺序排列的章节 id 数组。
 */
export async function reorderChaptersAction(params: {
  bookId: string;
  orderedIds: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const { data: book } = await supabase
    .from("books")
    .select("id,user_id")
    .eq("id", params.bookId)
    .single();

  if (!book || book.user_id !== profile.id) {
    return { ok: false, error: "无权限" };
  }

  const results = await Promise.all(
    params.orderedIds.map((id, idx) =>
      supabase
        .from("chapters")
        .update({ order_index: idx + 1 })
        .eq("id", id)
        .eq("book_id", params.bookId)
    )
  );

  const failed = results.find((r) => r.error);
  if (failed) {
    return { ok: false, error: "章节排序保存失败，请重试" };
  }

  revalidatePath(`/editor/${params.bookId}`);
  return { ok: true };
}
