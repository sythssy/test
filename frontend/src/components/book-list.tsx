"use client";

import { useMemo, useState } from "react";
import { BookCard } from "@/components/book-card";
import type { Book } from "@/lib/types";

type SortKey = "newest" | "oldest" | "alpha";

export function BookList({
  books,
  onDelete,
  onEdit
}: {
  books: Book[];
  onDelete: (formData: FormData) => Promise<void>;
  onEdit: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");

  const filtered = useMemo(() => {
    let list = [...books];
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((b) => b.title.toLowerCase().includes(q));
    }
    if (sort === "newest") list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    else if (sort === "oldest") list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    else list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return list;
  }, [books, query, sort]);

  if (!books.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-2xl">📖</p>
        <p className="mt-3 font-medium text-slate-700">还没有作品</p>
        <p className="mt-1 text-sm text-slate-500">在上方输入书名，创建你的第一本小说吧。</p>
      </div>
    );
  }

  return (
    <>
      {/* Search + Sort bar */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="按书名搜索…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring sm:max-w-xs"
        />
        <div className="flex items-center gap-1 sm:ml-auto">
          {(
            [
              { key: "newest", label: "最新" },
              { key: "oldest", label: "最早" },
              { key: "alpha", label: "标题 A-Z" }
            ] as { key: SortKey; label: string }[]
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSort(opt.key)}
              className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                sort === opt.key
                  ? "border-indigo-300 bg-indigo-50 text-indigo-700 font-medium"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500">
          未找到包含「{query}」的作品。
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((book) => (
            <BookCard key={book.id} book={book} onDelete={onDelete} onEdit={onEdit} />
          ))}
        </div>
      )}
    </>
  );
}
