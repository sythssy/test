import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { reviewText } from "@/lib/dify";

/**
 * AI 内容审核接口
 * 所有生成请求必须先通过此接口，再调用生成接口。
 */
export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json(
        { ok: false, pass: false, reason: "请先登录。" },
        { status: 401 }
      );
    }
    if (profile.status === "banned") {
      return NextResponse.json(
        { ok: false, pass: false, reason: "当前账号已被封禁。" },
        { status: 403 }
      );
    }

    const body = (await request.json()) as { text?: string };
    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { ok: false, pass: false, reason: "缺少待审核文本" },
        { status: 400 }
      );
    }

    if (text.length > 200000) {
      return NextResponse.json(
        { ok: false, pass: false, reason: "文本过长，请缩减后重试。" },
        { status: 400 }
      );
    }

    const result = reviewText(text);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { ok: false, pass: false, reason: "审核接口异常" },
      { status: 500 }
    );
  }
}
