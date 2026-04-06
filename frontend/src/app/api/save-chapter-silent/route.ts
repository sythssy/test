import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { EMPTY_TIPTAP_DOC } from "@/lib/chapter-content";

/**
 * beforeunload 静默保存：浏览器关闭/刷新时 keepalive POST，
 * 将未保存的编辑器内容写入数据库。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    if (profile.status === "banned") {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const body = (await request.json()) as {
      bookId?: string;
      chapterId?: string;
      content?: unknown;
      wordCount?: number;
    };

    const bookId    = (body.bookId ?? "").trim();
    const chapterId = (body.chapterId ?? "").trim();
    if (!bookId || !chapterId) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();

    const { data: book } = await supabase
      .from("books")
      .select("user_id")
      .eq("id", bookId)
      .single();

    if (!book || book.user_id !== profile.id) {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    const wordCount = Number.isFinite(body.wordCount) ? Math.max(0, body.wordCount!) : 0;

    const { error } = await supabase
      .from("chapters")
      .update({
        content: body.content ?? EMPTY_TIPTAP_DOC,
        word_count: wordCount
      })
      .eq("id", chapterId)
      .eq("book_id", bookId);

    if (error) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
