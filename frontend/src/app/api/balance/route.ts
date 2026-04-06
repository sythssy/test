import { NextResponse } from "next/server";
import { readSessionProfile } from "@/lib/server/session";

export async function GET() {
  const profile = await readSessionProfile();
  if (!profile) {
    return NextResponse.json({ ok: false, error_code: "UNAUTHORIZED" }, { status: 401 });
  }
  if (profile.status === "banned") {
    return NextResponse.json({ ok: false, error_code: "FORBIDDEN" }, { status: 403 });
  }

  return NextResponse.json({
    ok: true,
    flash_word_balance: profile.flash_word_balance,
    pro_word_balance: profile.pro_word_balance,
    workflow_credits: profile.workflow_credits ?? 0
  });
}
