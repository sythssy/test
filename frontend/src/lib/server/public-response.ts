/**
 * 生产环境不向客户端返回 detail 等调试字段，避免泄露底层信息。
 */
export function sanitizeForClient<T extends Record<string, unknown>>(body: T): T {
  if (process.env.NODE_ENV === "development") return body;
  const next = { ...body };
  delete next.detail;
  delete next.settlement_refund_detail;
  return next as T;
}
