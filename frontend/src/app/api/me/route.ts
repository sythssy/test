import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readSessionProfile } from "@/lib/server/session";
import type { DbUserProfile } from "@/lib/types";

export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const profile = await readSessionProfile();
  if (!profile) {
    const profileLookup = user
      ? await supabase
          .from("users")
          .select("id,email,role,status,flash_word_balance,pro_word_balance,workflow_credits")
          .eq("id", user.id)
          .maybeSingle<DbUserProfile>()
      : null;

    return NextResponse.json(
      {
        ok: false,
        error_code: "UNAUTHORIZED",
        message: "请先登录。",
        debug: {
          has_auth_user: Boolean(user),
          auth_user_id: user?.id ?? null,
          auth_email: user?.email ?? null,
          profile_lookup_error: profileLookup?.error?.message ?? null,
          profile_lookup_details: profileLookup?.error?.details ?? null,
          profile_lookup_hint: profileLookup?.error?.hint ?? null,
          profile_row_found: Boolean(profileLookup?.data)
        }
      },
      { status: 401 }
    );
  }
  return NextResponse.json({ ok: true, profile });
}
