import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isKnowledgeTableMissingMessage } from "@/lib/knowledge-items-api";

function tableUnavailableResponse() {
  return NextResponse.json(
    {
      ok: false,
      error_code: "TABLE_UNAVAILABLE",
      message:
        "知识库表未创建或未同步。全新库请执行 supabase/install_all.sql；已有库可从 archive/legacy-day-migrations/ 补跑 day24_knowledge_items.sql。"
    },
    { status: 503 }
  );
}

/** 列表：按作品拉取当前用户的知识库条目 */
export async function GET(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const bookId = new URL(request.url).searchParams.get("bookId")?.trim() ?? "";
    if (!bookId) {
      return NextResponse.json(
        { ok: false, error_code: "BAD_REQUEST", message: "缺少 bookId。" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { data: book } = await supabase
      .from("books")
      .select("id,user_id")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权查看该作品。" },
        { status: 403 }
      );
    }

    const { data, error } = await supabase
      .from("knowledge_items")
      .select("id,title,type,tags,content,created_at,updated_at,book_id")
      .eq("book_id", bookId)
      .order("created_at", { ascending: false });

    if (error) {
      if (isKnowledgeTableMissingMessage(error.message ?? "")) {
        return tableUnavailableResponse();
      }
      return NextResponse.json(
        { ok: false, error_code: "LIST_FAILED", message: "加载失败，请稍后重试。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "INTERNAL_ERROR", message: "加载失败，请稍后重试。" },
      { status: 500 }
    );
  }
}

/**
 * 写入 knowledge_items。用于脑洞「加入知识库」等；不扣费。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as {
      bookId?: string;
      title?: string;
      content?: string;
      type?: string;
      tags?: string[];
    };
    const bookId = (body.bookId ?? "").trim();
    const content = (body.content ?? "").trim().slice(0, 100000);
    if (!bookId || !content) {
      return NextResponse.json(
        { ok: false, error_code: "BAD_REQUEST", message: "缺少作品或正文内容。" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { data: book } = await supabase
      .from("books")
      .select("id,user_id,title")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "无权操作该作品。" },
        { status: 403 }
      );
    }

    const rawTitle = (body.title ?? "").trim();
    const title =
      rawTitle ||
      `脑洞 · 《${book.title}》 · ${new Date().toLocaleString("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      })}`;

    const type = (body.type ?? "brainstorm").trim().slice(0, 50) || "brainstorm";
    const rawTags = Array.isArray(body.tags) && body.tags.length > 0 ? body.tags : ["脑洞"];
    const tags = rawTags.slice(0, 20).map((t: string) => String(t).slice(0, 50));

    const { error } = await supabase.from("knowledge_items").insert({
      user_id: profile.id,
      book_id: bookId,
      title: title.length > 500 ? `${title.slice(0, 497)}…` : title,
      content,
      type,
      tags
    });

    if (error) {
      if (isKnowledgeTableMissingMessage(error.message ?? "")) {
        return tableUnavailableResponse();
      }
      return NextResponse.json(
        { ok: false, error_code: "SAVE_FAILED", message: "保存失败，请稍后重试。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "INTERNAL_ERROR", message: "保存失败，请稍后重试。" },
      { status: 500 }
    );
  }
}

/** 删除一条知识库记录（本人） */
export async function DELETE(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, error_code: "UNAUTHORIZED", message: "请先登录。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) {
      return NextResponse.json(
        { ok: false, error_code: "BAD_REQUEST", message: "缺少 id。" },
        { status: 400 }
      );
    }

    const supabase = createSupabaseServerClient();
    const { data: row, error: selErr } = await supabase
      .from("knowledge_items")
      .select("id,user_id")
      .eq("id", id)
      .maybeSingle();

    if (selErr) {
      if (isKnowledgeTableMissingMessage(selErr.message ?? "")) {
        return tableUnavailableResponse();
      }
      return NextResponse.json(
        { ok: false, error_code: "DELETE_FAILED", message: "删除失败，请稍后重试。" },
        { status: 500 }
      );
    }

    if (!row || row.user_id !== profile.id) {
      return NextResponse.json(
        { ok: false, error_code: "FORBIDDEN", message: "记录不存在或无权删除。" },
        { status: 403 }
      );
    }

    const { error: delErr } = await supabase.from("knowledge_items").delete().eq("id", id);

    if (delErr) {
      return NextResponse.json(
        { ok: false, error_code: "DELETE_FAILED", message: "删除失败，请稍后重试。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error_code: "INTERNAL_ERROR", message: "删除失败，请稍后重试。" },
      { status: 500 }
    );
  }
}
