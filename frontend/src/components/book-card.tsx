"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Book } from "@/lib/types";

const GENRE_PRESETS = ["玄幻", "言情", "都市", "悬疑", "科幻", "武侠", "历史", "其他"];

export function BookCard({
  book,
  onDelete,
  onEdit
}: {
  book: Book;
  onDelete: (formData: FormData) => Promise<void>;
  onEdit: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming]       = useState(false);
  const [editOpen, setEditOpen]           = useState(false);
  const [lastChapterId, setLastChapterId] = useState<string | null>(null);

  // Edit form state
  const [editTitle, setEditTitle] = useState(book.title);
  const [editGenre, setEditGenre] = useState(book.genre ?? "");
  const [editDesc, setEditDesc]   = useState(book.description ?? "");
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving]   = useState(false);

  const deleteFormRef  = useRef<HTMLFormElement>(null);
  // 记录弹窗上次的 open 状态，只在 false→true 时同步表单，避免编辑中被 revalidate 覆盖
  const prevEditOpen = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`last_chapter_${book.id}`);
      if (saved) setLastChapterId(saved);
    } catch {}
  }, [book.id]);

  // 只在弹窗从关→开时同步最新数据，避免编辑中因父组件 revalidate 覆盖未提交的输入
  useEffect(() => {
    if (editOpen && !prevEditOpen.current) {
      setEditTitle(book.title);
      setEditGenre(book.genre ?? "");
      setEditDesc(book.description ?? "");
      setEditError("");
    }
    prevEditOpen.current = editOpen;
  }, [editOpen, book.title, book.genre, book.description]);

  const totalWords   = (book.chapters ?? []).reduce((s, c) => s + (c.word_count ?? 0), 0);
  const chapterCount = (book.chapters ?? []).length;

  async function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTitle.trim()) { setEditError("书名不能为空"); return; }
    const fd = new FormData();
    fd.set("bookId",      book.id);
    fd.set("title",       editTitle.trim());
    fd.set("genre",       editGenre.trim());
    fd.set("description", editDesc.trim());
    setIsSaving(true);
    try {
      const res = await onEdit(fd);
      if (!res.ok) { setEditError(res.error ?? "保存失败"); return; }
      setEditOpen(false);
    } catch {
      setEditError("网络异常，请重试");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <article className="group relative rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-700 dark:bg-slate-900">
        {/* 封面占位 */}
        <div className="relative mb-3 flex h-28 items-end rounded-lg bg-gradient-to-br from-indigo-100 to-slate-100 p-3 dark:from-indigo-950/40 dark:to-slate-800">
          {totalWords > 0 && (
            <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-600 backdrop-blur dark:bg-slate-900/80 dark:text-slate-300">
              {totalWords >= 10000
                ? `${(totalWords / 10000).toFixed(1)} 万字`
                : `${totalWords.toLocaleString()} 字`}
              {chapterCount > 0 && ` · ${chapterCount} 章`}
            </span>
          )}
          {/* 编辑按钮 */}
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            title="编辑作品信息"
            className="absolute right-2 top-2 rounded-lg border border-white/60 bg-white/70 p-1 text-slate-500 opacity-0 backdrop-blur transition group-hover:opacity-100 hover:bg-white hover:text-slate-700 dark:border-slate-600/60 dark:bg-slate-800/70 dark:hover:bg-slate-700"
          >
            ✎
          </button>
        </div>

        <h3 className="line-clamp-1 font-medium text-slate-900 dark:text-white">{book.title}</h3>

        {/* 类型标签 + 简介 */}
        {book.genre && (
          <span className="mt-1 inline-block rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
            {book.genre}
          </span>
        )}
        {book.description && (
          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            {book.description}
          </p>
        )}

        <p className="mt-1 text-xs text-slate-400">
          创建于 {new Date(book.created_at).toLocaleDateString("zh-CN")}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {lastChapterId ? (
              <Link
                className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-center text-sm font-medium text-white hover:bg-indigo-700"
                href={`/editor/${book.id}/${lastChapterId}`}
              >
                继续写作 →
              </Link>
            ) : (
              <Link
                className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-center text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                href={`/editor/${book.id}`}
              >
                进入写作台
              </Link>
            )}
            <Link
              className="flex-1 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-1.5 text-center text-sm font-medium text-violet-900 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-900/40"
              href={`/dashboard/writing-tools?bookId=${encodeURIComponent(book.id)}`}
            >
              写作工具
            </Link>
          </div>

          {lastChapterId && (
            <Link
              className="text-center text-[11px] text-slate-400 hover:text-slate-600"
              href={`/editor/${book.id}`}
            >
              从第 1 章开始
            </Link>
          )}

          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="ml-auto rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-600 opacity-0 transition group-hover:opacity-100 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950/50"
            >
              删除
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">确认删除《{book.title}》？</span>
              <form ref={deleteFormRef} action={onDelete}>
                <input type="hidden" name="bookId" value={book.id} />
                <button type="submit" className="rounded border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-100">
                  确认
                </button>
              </form>
              <button type="button" onClick={() => setConfirming(false)} className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50">
                取消
              </button>
            </div>
          )}
        </div>
      </article>

      {/* 编辑弹窗 */}
      {editOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setEditOpen(false); }}
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h2 className="mb-4 text-base font-semibold text-slate-900 dark:text-white">编辑作品信息</h2>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              {/* 书名 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">书名 *</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* 类型 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">作品类型</label>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {GENRE_PRESETS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setEditGenre(editGenre === g ? "" : g)}
                      className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                        editGenre === g
                          ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300"
                          : "border-slate-200 text-slate-600 hover:border-indigo-300 dark:border-slate-600 dark:text-slate-400"
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <input
                  value={editGenre}
                  onChange={(e) => setEditGenre(e.target.value)}
                  maxLength={30}
                  placeholder="或自定义类型"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {/* 简介 */}
              <div>
                <label className="mb-1 flex items-baseline justify-between text-xs font-medium text-slate-500">
                  作品简介
                  <span className="font-normal text-slate-400">{editDesc.length}/500</span>
                </label>
                <textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  maxLength={500}
                  rows={4}
                  placeholder="简要介绍作品背景与主角…"
                  className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
                />
              </div>

              {editError && (
                <p className="text-xs text-rose-600">{editError}</p>
              )}

              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setEditOpen(false)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {isSaving ? "保存中…" : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
