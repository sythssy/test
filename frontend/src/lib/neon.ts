import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;

/** 服务端使用；未配置 DATABASE_URL 时返回 null */
export function getNeonSql(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  if (!url?.trim()) return null;
  if (!_sql) _sql = neon(url);
  return _sql;
}
