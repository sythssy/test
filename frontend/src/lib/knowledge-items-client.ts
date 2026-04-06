export type SaveKnowledgeItemResult =
  | { ok: true }
  | { ok: false; error_code?: string; message: string };

export type KnowledgeListItem = {
  id: string;
  title: string;
  type: string;
  tags: string[] | null;
  content: string;
  created_at: string;
  updated_at: string;
  book_id: string | null;
};

export type FetchKnowledgeItemsResult =
  | { ok: true; items: KnowledgeListItem[] }
  | { ok: false; error_code?: string; message: string };

export async function fetchKnowledgeItems(bookId: string): Promise<FetchKnowledgeItemsResult> {
  try {
    const res = await fetch(`/api/knowledge-items?bookId=${encodeURIComponent(bookId)}`, {
      method: "GET",
      cache: "no-store"
    });
    const json = (await res.json()) as {
      ok?: boolean;
      items?: KnowledgeListItem[];
      error_code?: string;
      message?: string;
    };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error_code: json.error_code,
        message: json.message || "加载失败。"
      };
    }
    return { ok: true, items: json.items ?? [] };
  } catch {
    return { ok: false, message: "网络异常，请重试。" };
  }
}

export type DeleteKnowledgeItemResult = { ok: true } | { ok: false; error_code?: string; message: string };

export async function deleteKnowledgeItem(id: string): Promise<DeleteKnowledgeItemResult> {
  try {
    const res = await fetch(`/api/knowledge-items?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const json = (await res.json()) as { ok?: boolean; error_code?: string; message?: string };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error_code: json.error_code,
        message: json.message || "删除失败。"
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "网络异常，请重试。" };
  }
}

export async function saveKnowledgeItem(body: {
  bookId: string;
  content: string;
  title?: string;
  type?: string;
  tags?: string[];
}): Promise<SaveKnowledgeItemResult> {
  try {
    const res = await fetch("/api/knowledge-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const json = (await res.json()) as { ok?: boolean; error_code?: string; message?: string };
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        error_code: json.error_code,
        message: json.message || "保存失败，请重试。"
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "网络异常，请重试。" };
  }
}

/** 保存 / 列表 / 删除等知识库接口的通用错误文案 */
export function messageForKnowledgeSaveFailure(result: {
  ok: false;
  error_code?: string;
  message?: string;
}) {
  if (result.error_code === "TABLE_UNAVAILABLE") {
    return (
      result.message ||
      "知识库表未就绪。全新库请执行 supabase/install_all.sql；已有库可从 archive/legacy-day-migrations/ 补跑 day24。"
    );
  }
  return result.message || "操作失败，请重试。";
}
