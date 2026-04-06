import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const profile = await readSessionProfile();
    if (!profile) {
      return NextResponse.json({ ok: false, error_code: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = (await request.json()) as { reason?: string };
    const reason = (body.reason ?? "").trim().slice(0, 2000);
    if (!reason) {
      return NextResponse.json({ ok: false, error_code: "BAD_REQUEST", message: "申诉原因不能为空" }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data: existing } = await supabase
      .from("appeals")
      .select("id")
      .eq("user_id", profile.id)
      .eq("status", "pending")
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: false, error_code: "DUPLICATE", message: "已有待处理申诉，请等待管理员处理。" }, { status: 409 });
    }

    const { error } = await supabase.from("appeals").insert({ user_id: profile.id, reason });
    if (error) {
      return NextResponse.json({ ok: false, error_code: "SAVE_FAILED", message: "申诉提交失败，请稍后重试。" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: "申诉已提交，请等待管理员审核。" });
  } catch {
    return NextResponse.json({ ok: false, error_code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
