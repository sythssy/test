import { AI_CHAPTER_CONTEXT_MAX_CHARS } from "@/lib/ai-context-limits";

/**
 * Tiptap / ProseMirror 文档 JSON（StarterKit 空文档）
 */
export const EMPTY_TIPTAP_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }]
} as const;

/**
 * 将数据库 chapters.content（jsonb）规范为可交给 Tiptap 的 doc JSON。
 * 兼容历史形态：{ type: "doc", text: string }
 */
export function normalizeChapterContent(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_TIPTAP_DOC };
  }
  const o = raw as Record<string, unknown>;
  if (o.type === "doc" && Array.isArray(o.content)) {
    return o as Record<string, unknown>;
  }
  if (o.type === "doc" && typeof o.text === "string") {
    const t = o.text;
    return {
      type: "doc",
      content: t
        ? [{ type: "paragraph", content: [{ type: "text", text: t }] }]
        : [{ type: "paragraph" }]
    };
  }
  return { ...EMPTY_TIPTAP_DOC };
}

/**
 * 将 Tiptap 文档 JSON 转为纯文本（用于 .txt 导出；列表/标题做简单换行）。
 */
export function tiptapDocToPlainText(doc: unknown): string {
  function nodeToText(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") return n.text;
    if (n.type === "hardBreak") return "\n";
    if (!Array.isArray(n.content)) return "";
    const inner = n.content.map(nodeToText).join("");
    switch (n.type) {
      case "paragraph":
      case "heading":
        return inner + "\n";
      case "bulletList":
      case "orderedList":
        return inner + "\n";
      case "listItem":
        return "· " + inner;
      case "blockquote":
        return inner + "\n";
      case "doc":
        return inner;
      default:
        return inner;
    }
  }

  const normalized = normalizeChapterContent(doc);
  const raw = nodeToText(normalized);
  return raw.replace(/\n{3,}/g, "\n\n").trim();
}

/** 超长章节时截取包含选段的窗口，避免请求体过大（润色/扩写/去痕共用） */
export function trimChapterContextAroundSelection(chapterPlain: string, selected: string, maxChars: number): string {
  if (chapterPlain.length <= maxChars) return chapterPlain;
  const t = selected.trim();
  const needle = t.slice(0, Math.min(120, Math.max(8, t.length)));
  let idx = needle.length >= 8 ? chapterPlain.indexOf(needle) : -1;
  if (idx < 0) {
    idx = Math.max(0, Math.floor((chapterPlain.length - maxChars) / 2));
  }
  const half = Math.floor(maxChars / 2);
  const start = Math.max(0, Math.min(idx - half, chapterPlain.length - maxChars));
  const end = Math.min(chapterPlain.length, start + maxChars);
  const prefix = start > 0 ? "…\n" : "";
  const suffix = end < chapterPlain.length ? "\n…" : "";
  return prefix + chapterPlain.slice(start, end) + suffix;
}

/** 服务端组装：带本章语境的润色用户消息（与 admin 提示词配合，由 Dify 侧理解） */
export function buildPolishUserTextWithContext(chapterPlain: string, selected: string): string {
  const ctx = trimChapterContextAroundSelection(chapterPlain, selected, AI_CHAPTER_CONTEXT_MAX_CHARS);
  const sel = selected.trim();
  return `以下是当前章节的正文（用于把握语境与衔接；请勿整章重写不要复述全文）：\n----\n${ctx}\n----\n\n请仅润色下面「待润色片段」，保持与前后文人称、时态与叙事风格一致。只输出润色后的该片段正文，不要前缀说明或解释：\n----\n${sel}\n----`;
}

/** 服务端组装：带本章语境的扩写用户消息 */
export function buildExpandUserTextWithContext(chapterPlain: string, selected: string): string {
  const ctx = trimChapterContextAroundSelection(chapterPlain, selected, AI_CHAPTER_CONTEXT_MAX_CHARS);
  const sel = selected.trim();
  return `以下是当前章节的正文（用于把握语气与人称、情节走向；请勿整章重写不要复述全文）：\n----\n${ctx}\n----\n\n请对下面「待扩写片段」进行扩写，与前后文自然衔接，可补充细节与描写但不要引入与上文矛盾的剧情。只输出扩写替换后的该片段正文，不要前缀说明或解释：\n----\n${sel}\n----`;
}

/** 服务端组装：带本章语境的去痕用户消息 */
export function buildDeAiUserTextWithContext(chapterPlain: string, selected: string): string {
  const ctx = trimChapterContextAroundSelection(chapterPlain, selected, AI_CHAPTER_CONTEXT_MAX_CHARS);
  const sel = selected.trim();
  return `以下是当前章节的正文（用于保持人称、时态与叙事风格一致；请勿整章重写不要复述全文）：\n----\n${ctx}\n----\n\n请对下面「待去痕片段」去 AI 痕迹：弱化套话与翻译腔、改为自然叙述，勿编造新剧情或改动关键事实。只输出去痕后的该片段正文，不要前缀说明或解释：\n----\n${sel}\n----`;
}

export function sanitizeFilenameSegment(name: string, maxLen = 80): string {
  return name
    .replace(/[\\/:*?"<>|\r\n\t]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, maxLen)
    .replace(/^_|_$/g, "") || "export";
}

type MdListCtx = { ordered: boolean; index: number };

function applyTextMarks(text: string, marks: unknown): string {
  if (!Array.isArray(marks) || marks.length === 0) return text;
  const types = new Set(
    marks.filter((m): m is { type: string } => m && typeof m === "object" && typeof (m as { type: string }).type === "string").map((m) => m.type)
  );
  let s = text;
  if (types.has("code")) {
    s = `\`${s.replace(/`/g, "\\`")}\``;
    types.delete("code");
  }
  const bold = types.has("bold");
  const italic = types.has("italic");
  if (bold && italic) s = `***${s}***`;
  else if (bold) s = `**${s}**`;
  else if (italic) s = `*${s}*`;
  if (types.has("strike")) s = `~~${s}~~`;
  return s;
}

/**
 * Tiptap / ProseMirror JSON → Markdown（与 plain 导出同源结构，便于 .md 下载）。
 */
export function tiptapDocToMarkdown(doc: unknown): string {
  function walk(node: unknown, listCtx: MdListCtx | null): string {
    if (!node || typeof node !== "object") return "";
    const n = node as Record<string, unknown>;
    if (n.type === "text" && typeof n.text === "string") {
      return applyTextMarks(n.text, n.marks);
    }
    if (n.type === "hardBreak") return "  \n";
    if (!Array.isArray(n.content)) return "";

    const innerJoin = n.content.map((c) => walk(c, listCtx)).join("");

    switch (n.type) {
      case "paragraph":
        return innerJoin + "\n\n";
      case "heading": {
        const levelRaw = (n.attrs as Record<string, unknown> | undefined)?.level;
        const level = typeof levelRaw === "number" && levelRaw >= 1 && levelRaw <= 6 ? levelRaw : 1;
        const hashes = "#".repeat(level);
        return `${hashes} ${innerJoin.trim()}\n\n`;
      }
      case "bulletList":
        return n.content.map((c) => walk(c, { ordered: false, index: 0 })).join("");
      case "orderedList":
        return n.content
          .map((c, idx) => walk(c, { ordered: true, index: idx + 1 }))
          .join("");
      case "listItem": {
        const prefix = listCtx?.ordered ? `${listCtx.index}. ` : "- ";
        const body = n.content.map((c) => walk(c, null)).join("").replace(/\n+$/, "");
        const lines = body.split("\n");
        const first = `${prefix}${lines[0] ?? ""}\n`;
        const rest = lines
          .slice(1)
          .map((line) => (line.length ? `  ${line}\n` : "\n"))
          .join("");
        return first + rest;
      }
      case "blockquote":
        return innerJoin
          .split("\n")
          .map((line) => (line.trim() ? `> ${line}\n` : ">\n"))
          .join("") + "\n";
      case "doc":
        return innerJoin;
      default:
        return innerJoin;
    }
  }

  const normalized = normalizeChapterContent(doc);
  return walk(normalized, null).replace(/\n{3,}/g, "\n\n").trim();
}
