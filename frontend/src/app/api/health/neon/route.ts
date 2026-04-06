import { NextResponse } from "next/server";
import { getNeonSql } from "@/lib/neon";

/**
 * 验证 Vercel + Neon 注入的 DATABASE_URL 是否可用（不替代 Supabase 业务库）。
 */
export async function GET() {
  const sql = getNeonSql();
  if (!sql) {
    return NextResponse.json({
      ok: false,
      neon: "skipped",
      message: "未设置 DATABASE_URL（完成 Vercel–Neon 集成后会自动注入，或本地在 .env.local 配置）。"
    });
  }
  try {
    const rows = await sql`SELECT 1 AS v`;
    const v = rows[0] as { v?: number } | undefined;
    if (v?.v !== 1) {
      return NextResponse.json({ ok: false, neon: "error", message: "查询结果异常。" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, neon: "connected" });
  } catch {
    return NextResponse.json(
      { ok: false, neon: "error", message: "无法连接 Neon，请检查 DATABASE_URL 与网络策略。" },
      { status: 503 }
    );
  }
}
