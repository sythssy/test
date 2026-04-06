import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";

export async function GET() {
  const profile = await readSessionProfile();
  if (!profile) {
    return NextResponse.json(
      { ok: false, error_code: "UNAUTHORIZED", message: "请先登录。" },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true, profile });
}
