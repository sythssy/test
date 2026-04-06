/** Dify / 账单共用的 action_type 字面量（与 ai_prompts.action_type 一致） */
export const AI_ACTION_BRAINSTORM_OUTLINE = "brainstorm_outline" as const;
export const AI_ACTION_CHAT = "chat" as const;
export const AI_ACTION_POLISH = "polish" as const;
export const AI_ACTION_EXPAND = "expand" as const;
export const AI_ACTION_DE_AI = "de_ai" as const;
/** 正文手动「段落查证」：联网/OOC 与设定核对（与主文档审核模式对齐） */
export const AI_ACTION_PARAGRAPH_VERIFY = "paragraph_verify" as const;
/** 工具台：各生成器独立 action_type，便于独立提示词与账单统计 */
export const AI_ACTION_BOOK_TITLE = "book_title" as const;
export const AI_ACTION_BOOK_BLURB = "book_blurb" as const;
export const AI_ACTION_BOOK_OUTLINE = "book_outline" as const;
export const AI_ACTION_FINE_OUTLINE = "fine_outline" as const;
export const AI_ACTION_GOLDEN_OPENING = "golden_opening" as const;
export const AI_ACTION_GOLDEN_FINGER = "golden_finger" as const;
export const AI_ACTION_NAME_GEN = "name_gen" as const;
export const AI_ACTION_CHARACTER_SETTING = "character_setting" as const;
export const AI_ACTION_WORLDVIEW = "worldview" as const;
export const AI_ACTION_GLOSSARY_ENTRY = "glossary_entry" as const;
export const AI_ACTION_COVER_COPY = "cover_copy" as const;
/** 管理员福利入账（billing_logs；非 Dify action） */
export const AI_ACTION_WELFARE_CREDIT = "welfare_credit" as const;
/** 预扣结算：实际用量小于预扣额时的退还（billing_logs 中 cost_words 为负） */
export const AI_ACTION_WORD_REFUND_SETTLEMENT = "word_refund_settlement" as const;
/** 生成失败等：预扣全额退回（billing_logs 中 cost_words 为负） */
export const AI_ACTION_WORD_REFUND_ABORTED = "word_refund_aborted" as const;
