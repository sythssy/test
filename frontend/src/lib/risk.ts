import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 服务端风控执行器：审核命中后写 risk_logs 并按规则封禁
 * 1次命中 → warning
 * 2次及以上 → banned
 * 返回 action: "warning" | "banned"
 */
export async function applyRisk(
  supabase: SupabaseClient,
  userId: string,
  hitKeyword: string,
  inputText: string
): Promise<"warning" | "banned"> {

  const { data: prevLogs } = await supabase
    .from("risk_logs")
    .select("id")
    .eq("user_id", userId);

  const prevCount = (prevLogs ?? []).length;
  const action: "warning" | "banned" = prevCount >= 1 ? "banned" : "warning";

  await supabase.from("risk_logs").insert({
    user_id: userId,
    hit_keyword: hitKeyword,
    input_text: inputText.slice(0, 500),
    action_taken: action
  });

  if (action === "banned") {
    await supabase.from("users").update({ status: "banned" }).eq("id", userId);
  }

  return action;
}
