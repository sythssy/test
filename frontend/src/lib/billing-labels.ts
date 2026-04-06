/** 产品引擎名称 */
export const BILLING_FLASH_BASE_WORDS_LABEL = "极速创作引擎字数";
export const BILLING_PRO_ADV_WORDS_LABEL    = "深度创作引擎字数";

/** 产品引擎短名（用于余额展示、表头等空间较小处） */
export const BILLING_FLASH_SHORT = "极速创作引擎";
export const BILLING_PRO_SHORT   = "深度创作引擎";

/** 引擎描述（用于模型选择器、帮助文案等） */
export const BILLING_FLASH_DESC =
  "专为日常高效续写设计，生成速度快，额度消耗低，适合脑洞大纲、标题、内容生成。";
export const BILLING_PRO_DESC =
  "专为深度内容创作设计，逻辑更严谨，人设更稳定，适合正文写作、短篇剧情写作。";

/** 与字数并列：整链创作流程次数 */
export const BILLING_WORKFLOW_CREDITS_SHORT = "创作工作流次数";

/** 前台显著位置：额度与风控说明 */
export const PLATFORM_USAGE_RULE_BANNER =
  "为保障正常创作体验，单日超额使用会小幅溢价 + 风控审核，杜绝恶意批量刷量。";

/** 字数扣费池 → 与用户可见的资产名一致 */
export function wordPoolLabel(pool: "flash" | "pro"): string {
  return pool === "pro" ? BILLING_PRO_ADV_WORDS_LABEL : BILLING_FLASH_BASE_WORDS_LABEL;
}

/**
 * 用户可见扣费说明（不出现技术术语）。
 */
export function formatQuotaChargeDetail(opts: {
  pool: "flash" | "pro";
  reading: number;
  writing: number;
  totalCharged: number;
  modelName: string;
  modelKey: string;
}): string {
  return `本次处理：阅读 ${opts.reading.toLocaleString()} 字，写作 ${opts.writing.toLocaleString()} 字，总计消耗 ${opts.totalCharged.toLocaleString()} 字数额度（自「${wordPoolLabel(opts.pool)}」扣除；模型：${opts.modelName}）。`;
}

/** 深度创作引擎单日累计输出超 30 万时追加加价说明 */
export function appendDailySurchargeNote(detail: string, baseCharged: number, effectiveCharged: number): string {
  if (effectiveCharged <= baseCharged) return detail;
  return `${detail}\n※ 本自然日深度创作引擎累计输出已超过 30 万字，本次按规则以 1.2 倍计入额度，实际扣减 ${effectiveCharged.toLocaleString()} 字（未加价折算约 ${baseCharged.toLocaleString()} 字）。`;
}
