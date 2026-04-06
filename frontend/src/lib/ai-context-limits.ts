/**
 * 本章正文摘录传入模型的字符上限（聊天附带上下文、润色/扩写/去痕「本章」模式开窗与此一致；服务端聊天接口同值截断）。
 */
export const AI_CHAPTER_CONTEXT_MAX_CHARS = 120_000;

/** 前台展示用（与产品「万字」口径一致：12 万 = 120 000 字） */
export const AI_CHAPTER_CONTEXT_MAX_USER_LABEL = "12 万字";

/** 侧栏、工具提示等复用一句说明（聊天摘录固定为 12 万字，按字符计） */
export const AI_CHAPTER_CONTEXT_LIMIT_HINT = `附带本章摘录时，单次固定最多 ${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}（按字符计），超出部分截断后再发给模型；与润色/扩写/去痕「本章」模式同一上限。`;
