"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// ── 书籍信息编辑 ─────────────────────────────────────────────────────────────

export async function editBookAction(formData: FormData) {
  const profile = await requireAuth();
  const bookId      = String(formData.get("bookId") ?? "").trim();
  const title       = String(formData.get("title") ?? "").trim().slice(0, 100);
  const genre       = String(formData.get("genre") ?? "").trim().slice(0, 30);
  const description = String(formData.get("description") ?? "").trim().slice(0, 500);

  if (!bookId || !title) return { ok: false, error: "书名不能为空" };

  const supabase = createSupabaseServerClient();
  const { data: book } = await supabase
    .from("books")
    .select("user_id")
    .eq("id", bookId)
    .single();

  if (!book || book.user_id !== profile.id) return { ok: false, error: "无权限" };

  const { error } = await supabase
    .from("books")
    .update({ title, genre: genre || null, description: description || null })
    .eq("id", bookId);

  if (error) return { ok: false, error: "保存失败" };

  revalidatePath("/dashboard");
  return { ok: true };
}

// ── 写作统计 ─────────────────────────────────────────────────────────────────

export interface WritingStats {
  todayWords: number;
  streak: number;      // 连续创作天数
  totalDays: number;   // 历史累计有效创作天数
}

/** 统一获取上海时区日期字符串 "YYYY-MM-DD" */
function shanghaiDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

export async function getWritingStatsAction(): Promise<WritingStats> {
  const profile = await requireAuth();
  const supabase = createSupabaseServerClient();

  const todayStr  = shanghaiDate(0);
  // streak 用最近 100 天窗口（足够检测任何连续天数）
  const cutoffStr = shanghaiDate(-99);

  const [{ data: rows }, { count: totalCount }] = await Promise.all([
    supabase
      .from("daily_writing_stats")
      .select("stat_date, words_added")
      .eq("user_id", profile.id)
      .gte("stat_date", cutoffStr)
      .order("stat_date", { ascending: false }),
    // totalDays 单独全量 count，不受 100 天窗口限制
    supabase
      .from("daily_writing_stats")
      .select("*", { count: "exact", head: true })
      .eq("user_id", profile.id)
      .gt("words_added", 0)
  ]);

  const dateSet  = new Set((rows ?? []).map((r) => r.stat_date as string));
  const todayWords = (rows ?? []).find((r) => r.stat_date === todayStr)?.words_added ?? 0;

  // 连续天数：全程使用上海时区，避免服务器本地 TZ 导致偏差
  let streak = 0;
  // 今天未写则从昨天起算，不立即清零连续记录
  let cursorStr = dateSet.has(todayStr) ? todayStr : shanghaiDate(-1);
  for (let i = 0; i < 100; i++) {
    if (!dateSet.has(cursorStr)) break;
    streak++;
    // 往前推一天（字符串运算避免 Date 对象时区偏差）
    const prev = new Date(cursorStr + "T12:00:00Z"); // 用 UTC 中午避免夏令时边界
    prev.setUTCDate(prev.getUTCDate() - 1);
    cursorStr = prev.toISOString().slice(0, 10);
  }

  return { todayWords, streak, totalDays: totalCount ?? 0 };
}
