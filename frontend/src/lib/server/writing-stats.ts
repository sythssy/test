import type { SupabaseClient } from "@supabase/supabase-js";

export interface WritingStats {
  todayWords: number;
  streak: number;
  totalDays: number;
}

function shanghaiDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function computeWritingStats(supabase: SupabaseClient, userId: string): Promise<WritingStats> {
  const todayStr = shanghaiDate(0);
  const cutoffStr = shanghaiDate(-99);

  const [{ data: rows }, { count: totalCount }] = await Promise.all([
    supabase
      .from("daily_writing_stats")
      .select("stat_date, words_added")
      .eq("user_id", userId)
      .gte("stat_date", cutoffStr)
      .order("stat_date", { ascending: false }),
    supabase
      .from("daily_writing_stats")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("words_added", 0)
  ]);

  const dateSet = new Set((rows ?? []).map((r) => r.stat_date as string));
  const todayWords = (rows ?? []).find((r) => r.stat_date === todayStr)?.words_added ?? 0;

  let streak = 0;
  let cursorStr = dateSet.has(todayStr) ? todayStr : shanghaiDate(-1);
  for (let i = 0; i < 100; i++) {
    if (!dateSet.has(cursorStr)) break;
    streak++;
    const prev = new Date(cursorStr + "T12:00:00Z");
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursorStr = prev.toISOString().slice(0, 10);
  }

  return { todayWords, streak, totalDays: totalCount ?? 0 };
}
