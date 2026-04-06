import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const profile = await readSessionProfile();
  if (!profile) {
    return NextResponse.json(
      {
        ok: false,
        error_code: "UNAUTHORIZED",
        message: "请先登录。",
        debug: {
          has_auth_user: Boolean(user),
          auth_user_id: user?.id ?? null,
          auth_email: user?.email ?? null
        }
      },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true, profile });
}
