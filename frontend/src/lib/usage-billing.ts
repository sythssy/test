import type { DifyUsage } from "@/lib/dify";

const safeInt = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
};

/**
 * 总吞吐量合并计费：prompt_tokens + completion_tokens（1:1 计入额度，从单一 Flash/Pro 池扣减）。
 * 不单独维护「输入余额 / 输出余额」。
 */
export function billableTotalsFromUsage(usage: DifyUsage | undefined): {
  promptTokens: number;
  completionTokens: number;
  totalBillable: number;
} {
  const promptTokens = safeInt(usage?.input_tokens);
  const completionTokens = safeInt(usage?.output_tokens);
  const totalBillable = promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalBillable };
}
