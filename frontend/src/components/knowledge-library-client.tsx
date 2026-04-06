"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  deleteKnowledgeItem,
  fetchKnowledgeItems,
  messageForKnowledgeSaveFailure,
  type KnowledgeListItem
} from "@/lib/knowledge-items-client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type BookRow = { id: string; title: string };

function formatTs(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export function KnowledgeLibraryClient({
  books,
  initialBookId
}: {
  books: BookRow[];
  initialBookId: string | null;
}) {
  const defaultBookId = useMemo(() => {
    if (initialBookId && books.some((b) => b.id === initialBookId)) return initialBookId;
    return books[0]?.id ?? "";
  }, [initialBookId, books]);

  const [bookId, setBookId] = useState(defaultBookId);
  const [items, setItems] = useState<KnowledgeListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailItem, setDetailItem] = useState<KnowledgeListItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [filterType, setFilterType] = useState("");

  const load = useCallback(async () => {
    if (!bookId) {
      setItems([]);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const out = await fetchKnowledgeItems(bookId);
    setLoading(false);
    if (!out.ok) {
      const msg =
        out.error_code === "TABLE_UNAVAILABLE"
          ? messageForKnowledgeSaveFailure(out)
          : out.message || "加载失败";
      setLoadError(msg);
      setItems([]);
      return;
    }
    setItems(out.items);
  }, [bookId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedBook = books.find((b) => b.id === bookId);

  const allTypes = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.type) s.add(it.type);
    return [...s].sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return items.filter((it) => {
      if (filterType && it.type !== filterType) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.content.toLowerCase().includes(q) ||
        (it.tags ?? []).some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [items, searchText, filterType]);

  const onDelete = async (id: string) => {
    if (!confirm("确定删除这条素材？不可恢复。")) return;
    setDeletingId(id);
    const out = await deleteKnowledgeItem(id);
    setDeletingId(null);
    if (!out.ok) {
      toast.error(out.message || "删除失败");
      return;
    }
    toast.success("已删除");
    setDetailItem((cur) => (cur?.id === id ? null : cur));
    void load();
  };

  if (books.length === 0) {
    return (
      <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
        暂无作品。请先到{" "}
        <Link href="/dashboard" className="font-medium underline">
          作品库
        </Link>{" "}
        新建后再整理知识库。
      </p>
    );
  }

  return (
    <>
      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[12rem] flex-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">当前作品</label>
            <select
              value={bookId}
              onChange={(e) => setBookId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[10rem] flex-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">搜索内容</label>
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="标题 / 正文 / 标签"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            />
          </div>
          {allTypes.length > 0 ? (
            <div className="min-w-[8rem]">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">类型筛选</label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                <option value="">全部</option>
                {allTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading || !bookId}
              className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
            >
              {loading ? "加载中…" : "刷新"}
            </button>
            {bookId ? (
              <Link
                href={`/editor/${bookId}`}
                className="inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100 dark:hover:bg-indigo-900/40"
              >
                进入写作
              </Link>
            ) : null}
            {bookId ? (
              <Link
                href={`/dashboard/writing-tools?bookId=${encodeURIComponent(bookId)}`}
                className="inline-flex items-center justify-center rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
              >
                写作工具台
              </Link>
            ) : null}
          </div>
        </div>
      </section>

      {loadError ? (
        <p className="mb-4 rounded-xl border border-rose-100 bg-rose-50/90 px-4 py-3 text-sm text-rose-900 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-100">
          {loadError}
        </p>
      ) : null}

      {!loading && !loadError && items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          本书暂无知识库条目。在编辑器「脑洞生成」结果处可点击「加入知识库」，条目会出现在此列表。
        </p>
      ) : null}

      {!loading && items.length > 0 && filteredItems.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
          没有符合条件的条目。
        </p>
      ) : null}

      {!loading && items.length > 0 ? (
        <p className="mb-2 text-xs text-slate-400">
          共 {items.length} 条，{filteredItems.length !== items.length ? `筛选后 ${filteredItems.length} 条` : "全部显示"}
        </p>
      ) : null}

      <ul className="space-y-3">
        {filteredItems.map((item) => (
          <li
            key={item.id}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-white">{item.title}</p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="mr-2">类型：{item.type || "—"}</span>
                  <span>{formatTs(item.created_at)}</span>
                  {item.tags && item.tags.length > 0 ? (
                    <span className="mt-1 block text-slate-400">
                      标签：{item.tags.join("、")}
                    </span>
                  ) : null}
                </p>
                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300">
                  {item.content}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col sm:items-stretch">
                <button
                  type="button"
                  onClick={() => setDetailItem(item)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  查看全文
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(item.content);
                      toast.success("正文已复制");
                    } catch {
                      toast.error("复制失败");
                    }
                  }}
                  className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100"
                >
                  复制正文
                </button>
                <button
                  type="button"
                  disabled={deletingId === item.id}
                  onClick={() => void onDelete(item.id)}
                  className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
                >
                  {deletingId === item.id ? "删除中…" : "删除"}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={!!detailItem} onOpenChange={(open) => !open && setDetailItem(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          {detailItem ? (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{detailItem.title}</DialogTitle>
                <DialogDescription className="text-left">
                  {selectedBook?.title ? `作品：${selectedBook.title} · ` : null}
                  {formatTs(detailItem.created_at)}
                  {detailItem.type ? ` · 类型：${detailItem.type}` : null}
                </DialogDescription>
              </DialogHeader>
              <pre className="mt-2 max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200">
                {detailItem.content}
              </pre>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(detailItem.content);
                      toast.success("已复制");
                    } catch {
                      toast.error("复制失败");
                    }
                  }}
                  className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-100"
                >
                  复制全文
                </button>
                <button
                  type="button"
                  onClick={() => void onDelete(detailItem.id)}
                  disabled={deletingId === detailItem.id}
                  className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-200"
                >
                  删除
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
