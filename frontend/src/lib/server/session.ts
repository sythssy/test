import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DbUserProfile } from "@/lib/types";

/** 仅供 `app/api/**` 与 `middleware` 使用：用 Cookie 会话读当前用户与 `public.users` 资料。 */
export async function readSessionProfile(): Promise<DbUserProfile | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("id,email,role,status,flash_word_balance,pro_word_balance,workflow_credits")
    .eq("id", user.id)
    .single<DbUserProfile>();

  return data ?? null;
}
