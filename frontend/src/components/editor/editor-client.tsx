"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import {
  createChapterAction,
  saveChapterAction,
  renameChapterAction,
  deleteChapterAction,
  saveBookModelKeyAction,
  exportFullBookPlainTextAction,
  exportFullBookMarkdownAction,
  exportFullBookDocxAction,
  exportChapterDocxFromEditorAction,
  reorderChaptersAction,
  createChapterSnapshotAction,
  listChapterSnapshotsAction,
  restoreChapterSnapshotAction,
  deleteChapterSnapshotAction,
  type ChapterSnapshotMeta
} from "@/app/editor/[bookId]/[chapterId]/actions";
import {
  sanitizeFilenameSegment,
  tiptapDocToMarkdown,
  tiptapDocToPlainText,
  trimChapterContextAroundSelection
} from "@/lib/chapter-content";
import type { AiModelOption } from "@/lib/types";
import type { JSONContent } from "@tiptap/core";
import { BILLING_WORKFLOW_CREDITS_SHORT, wordPoolLabel } from "@/lib/billing-labels";
import {
  AI_CHAPTER_CONTEXT_LIMIT_HINT,
  AI_CHAPTER_CONTEXT_MAX_CHARS,
  AI_CHAPTER_CONTEXT_MAX_USER_LABEL
} from "@/lib/ai-context-limits";
import { FindReplaceBar } from "@/components/editor/find-replace-bar";
import { DuplicateCheckPanel } from "@/components/editor/duplicate-check-panel";
import { useAiConfirm, estimateAiCost } from "@/components/ai-cost-confirm";
import { AI_ACTION_DE_AI, AI_ACTION_EXPAND, AI_ACTION_POLISH } from "@/lib/ai-action-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { fetchBrainstormOutline, messageForBrainstormFailure } from "@/lib/brainstorm-outline-client";
import {
  deleteKnowledgeItem,
  fetchKnowledgeItems,
  messageForKnowledgeSaveFailure,
  saveKnowledgeItem,
  type KnowledgeListItem
} from "@/lib/knowledge-items-client";
import { WRITING_TOOL_QUICK_NAV_EDITOR } from "@/lib/writing-tools-config";

interface ChapterItem {
  id: string;
  title: string;
  order_index: number;
  /** 库内统计；当前章在列表中会与编辑器实时字数同步展示 */
  word_count: number;
  /** 若库内有列则展示「创建于」 */
  created_at?: string | null;
}

function formatChapterSidebarMeta(orderIndex: number, createdAt?: string | null) {
  const n = Number(orderIndex) || 1;
  const parts: string[] = [`第 ${n} 章`];
  if (createdAt) {
    const d = new Date(createdAt);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`创建于 ${d.toLocaleDateString("zh-CN", { year: "numeric", month: "numeric", day: "numeric" })}`);
    }
  }
  return parts.join(" · ");
}

type LastGenerateAction =
  | { kind: "polish_snippet" }
  | { kind: "polish_chapter" }
  | { kind: "expand_snippet" }
  | { kind: "expand_chapter" }
  | { kind: "de_ai_snippet" }
  | { kind: "de_ai_chapter" };

function plainTextToTipTapParagraphs(text: string) {
  const lines = text.split("\n");
  return lines.map((line) => ({
    type: "paragraph" as const,
    content: line.length ? [{ type: "text" as const, text: line }] : []
  }));
}

type FontFamily = "sans" | "serif" | "mono";
type LineHeight = "1.6" | "1.8" | "2.0";

const FONT_FAMILIES: { key: FontFamily; label: string; css: string }[] = [
  { key: "sans", label: "系统无衬线", css: "ui-sans-serif, system-ui, sans-serif" },
  { key: "serif", label: "中文阅读", css: "'Noto Serif SC', 'Source Han Serif', Georgia, serif" },
  { key: "mono", label: "等宽字体", css: "'JetBrains Mono', 'Fira Mono', Consolas, monospace" }
];

function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBase64File(filename: string, base64: string, mime: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function EditorClient({
  bookId,
  bookTitle,
  currentChapterId,
  initialDoc,
  initialWordCount,
  initialConversationId,
  currentModelKey: initialModelKey,
  availableModels,
  chapters: initialChapters
}: {
  bookId: string;
  bookTitle: string;
  currentChapterId: string;
  initialDoc: JSONContent;
  initialWordCount: number;
  initialConversationId: string;
  currentModelKey?: string;
  availableModels: AiModelOption[];
  chapters: ChapterItem[];
}) {
  const router = useRouter();
  const [chapters, setChapters] = useState(initialChapters);
  const [wordCount, setWordCount] = useState(initialWordCount);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [fontSize, setFontSize] = useState<14 | 16 | 18 | 20>(16);
  const [fontFamily, setFontFamily] = useState<FontFamily>("sans");
  const [lineHeight, setLineHeight] = useState<LineHeight>("1.8");
  const [indentFirst, setIndentFirst] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [aiStatus, setAiStatus] = useState<"idle" | "running">("idle");
  const [aiMessage, setAiMessage] = useState("");
  const [lastAiAction, setLastAiAction] = useState<LastGenerateAction | null>(null);
  const [canRetryAi, setCanRetryAi] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [chatConversationId, setChatConversationId] = useState(initialConversationId);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState<"idle" | "sending">("idle");
  const [chatError, setChatError] = useState("");
  const [chatBillingNote, setChatBillingNote] = useState("");
  /** 侧栏聊天是否在每条消息中附带本章正文摘录（有选区时优先以选区为中心开窗；摘录固定上限 12 万字） */
  const [chatAttachChapterContext, setChatAttachChapterContext] = useState(true);
  /** 沉浸写作：仅「续写聊天」用顶栏下拉；脑洞与查证各自独立按钮 */
  const [immersiveToolbarMenu, setImmersiveToolbarMenu] = useState<null | "chat">(null);
  const [chatMessages, setChatMessages] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string }>
  >([]);
  const [brainstormDialogOpen, setBrainstormDialogOpen] = useState(false);
  const [brainstormIp, setBrainstormIp] = useState("");
  const [brainstormCharacter, setBrainstormCharacter] = useState("");
  const [brainstormTimeline, setBrainstormTimeline] = useState("");
  const [brainstormStatus, setBrainstormStatus] = useState<"idle" | "running">("idle");
  const [brainstormMessage, setBrainstormMessage] = useState("");
  const [brainstormResult, setBrainstormResult] = useState("");
  const [brainstormKbSaving, setBrainstormKbSaving] = useState(false);
  // 右侧知识库面板
  const [kbPanelOpen, setKbPanelOpen] = useState(false);
  const [kbItems, setKbItems] = useState<KnowledgeListItem[]>([]);
  const [kbLoading, setKbLoading] = useState(false);
  const [kbError, setKbError] = useState<string | null>(null);
  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyRunning, setVerifyRunning] = useState(false);
  const [verifyAnswer, setVerifyAnswer] = useState("");
  const [verifyBillingLine, setVerifyBillingLine] = useState("");
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [dupCheckOpen, setDupCheckOpen] = useState(false);
  const [selectedModelKey, setSelectedModelKey] = useState(initialModelKey ?? "default");
  /** 窄屏（≤767px）：默认只读直至用户明确选择「仍要编辑」 */
  const [narrowScreen, setNarrowScreen] = useState(false);
  const [mobileEditingEnabled, setMobileEditingEnabled] = useState(false);
  const [mobileBannerDismissed, setMobileBannerDismissed] = useState(false);

  // 历史快照
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ChapterSnapshotMeta[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotRestoring, setSnapshotRestoring] = useState<string | null>(null);

  const toolbarModelBillingHint = useMemo(() => {
    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const poolLabel = wordPoolLabel(pool);
    const displayName =
      selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey);
    const shortLine = `扣费归属：${poolLabel} · 模型「${displayName}」`;
    const titleLine = `${shortLine}。润色/扩写/去痕、脑洞生成、段落查证与聊天均按模型返回的「阅读+写作」用量合并为字数额度扣减；脑洞/查证在不适配当前模型时会依次回退专用默认或通用 default；聊天以每次回复下方说明为准。带「本章」的操作与侧栏「附带本章摘录」共用单次上下文上限 ${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}（按字符计）。`;
    return { shortLine, titleLine };
  }, [availableModels, selectedModelKey]);

  const { aiConfirmDialog, confirmAiCall } = useAiConfirm();

  // Chapter management state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const dragSrcId = useRef<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [chapterOpStatus, setChapterOpStatus] = useState("");

  const [isPending, startTransition] = useTransition();
  const lastSavedJson = useRef("");
  const chapterIdRef = useRef(currentChapterId);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const immersiveMenusRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chapterIdRef.current = currentChapterId;
  }, [currentChapterId]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      const n = mq.matches;
      setNarrowScreen(n);
      if (!n) {
        setMobileEditingEnabled(true);
        setMobileBannerDismissed(false);
      } else {
        setMobileEditingEnabled(false);
        setMobileBannerDismissed(false);
      }
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!immersive) setImmersiveToolbarMenu(null);
  }, [immersive]);

  useEffect(() => {
    if (!immersiveToolbarMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImmersiveToolbarMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [immersiveToolbarMenu]);

  useEffect(() => {
    if (!immersiveToolbarMenu) return;
    const onDoc = (e: MouseEvent) => {
      if (immersiveMenusRef.current?.contains(e.target as Node)) return;
      setImmersiveToolbarMenu(null);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [immersiveToolbarMenu]);

  const chapterCount = useMemo(() => chapters.length, [chapters.length]);

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, Underline],
    content: initialDoc,
    onCreate: ({ editor: created }) => {
      lastSavedJson.current = JSON.stringify(created.getJSON());
    },
    onUpdate: ({ editor: currentEditor }) => {
      const nextText = currentEditor.getText();
      setWordCount(nextText.trim().length);

      const serialized = JSON.stringify(currentEditor.getJSON());
      if (serialized === lastSavedJson.current) return;

      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const scheduledChapterId = currentChapterId;
      const plannedDoc = currentEditor.getJSON();
      const plannedWc = currentEditor.getText().trim().length;
      saveTimer.current = setTimeout(async () => {
        if (chapterIdRef.current !== scheduledChapterId) return;
        const result = await saveChapterAction({
          bookId:    bookIdRef.current,
          chapterId: scheduledChapterId,
          content:   plannedDoc,
          wordCount: plannedWc
        });
        // 保存返回后再次校验：若用户已切章则不更新当前章的 UI 状态
        if (chapterIdRef.current !== scheduledChapterId) return;
        if (result.ok) {
          lastSavedJson.current = JSON.stringify(plannedDoc);
          setWordCount(result.wordCount ?? plannedWc);
          setSaveState("saved");
        } else {
          setSaveState("error");
        }
      }, 1000);
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      setSelectedCount(currentEditor.state.doc.textBetween(from, to, " ").trim().length);
    }
  });

  useEffect(() => {
    if (!editor) return;
    const allow = !narrowScreen || mobileEditingEnabled;
    editor.setEditable(allow);
  }, [editor, narrowScreen, mobileEditingEnabled]);

  const canEditChapter = !narrowScreen || mobileEditingEnabled;

  useEffect(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (!editor) return;
    editor.commands.setContent(initialDoc);
    setWordCount(initialWordCount);
    setSaveState("saved");
    setSelectedCount(0);
    lastSavedJson.current = JSON.stringify(editor.getJSON());
  }, [initialDoc, initialWordCount, currentChapterId, editor]);

  useEffect(() => {
    setChatConversationId(initialConversationId);
    const storageKey = `chat:${bookId}`;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) { setChatMessages([]); return; }
    try {
      const parsed = JSON.parse(raw) as Array<{ id: string; role: "user" | "assistant"; content: string }>;
      setChatMessages(Array.isArray(parsed) ? parsed : []);
    } catch { setChatMessages([]); }
  }, [bookId, initialConversationId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`chat:${bookId}`, JSON.stringify(chatMessages.slice(-60)));
    } catch {}
  }, [bookId, chatMessages]);

  // bookIdRef 保证 beforeunload 闭包里永远拿到最新值
  const bookIdRef = useRef(bookId);
  useEffect(() => { bookIdRef.current = bookId; }, [bookId]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveState === "saving") { e.preventDefault(); return; }
      if (editor) {
        const doc = editor.getJSON();
        const serialized = JSON.stringify(doc);
        if (serialized !== lastSavedJson.current) {
          const wc = editor.getText().trim().length;
          // 使用 ref 避免闭包陈旧：chapterIdRef 已在 currentChapterId 变化时同步更新
          fetch("/api/save-chapter-silent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bookId:    bookIdRef.current,
              chapterId: chapterIdRef.current,
              content:   doc,
              wordCount: wc
            }),
            keepalive: true
          }).catch(() => { /* 静默 */ });
        }
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (chatAbortRef.current) chatAbortRef.current.abort();
    };
  }, [saveState, editor]);

  // Cmd+H → find/replace
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault();
        setFindReplaceOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /** 跳转前先自动保存当前章节；保存完成后再导航，避免内容丢失。 */
  const autoSaveAndNavigate = async (href: string) => {
    if (!editor) { router.push(href); return; }
    const doc = editor.getJSON();
    const serialized = JSON.stringify(doc);
    // 无变更直接跳
    if (serialized === lastSavedJson.current) { router.push(href); return; }
    setSaveState("saving");
    const wc = editor.getText().trim().length;
    const result = await saveChapterAction({ bookId, chapterId: currentChapterId, content: doc, wordCount: wc });
    if (result.ok) {
      lastSavedJson.current = serialized;
      setWordCount(result.wordCount ?? wc);
      setSaveState("saved");
    } else {
      setSaveState("error");
      // 仍然跳转，不阻断用户
    }
    router.push(href);
  };
  // 兼容旧调用名
  const safeNavigate = (href: string) => { void autoSaveAndNavigate(href); };

  const onModelChange = (key: string) => {
    setSelectedModelKey(key);
    void saveBookModelKeyAction({ bookId, modelKey: key });
  };

  const onCreateChapter = () => {
    startTransition(async () => {
      const result = await createChapterAction(bookId, chapterCount);
      if (result.chapterId) {
        safeNavigate(`/editor/${bookId}/${result.chapterId}`);
      }
    });
  };

  const onRenameChapter = async (chapterId: string) => {
    if (!renameValue.trim()) return;
    setChapterOpStatus("重命名中…");
    const result = await renameChapterAction({ bookId, chapterId, title: renameValue });
    if (result.ok) {
      setChapters((prev) => prev.map((c) => c.id === chapterId ? { ...c, title: result.title ?? c.title } : c));
      setChapterOpStatus("");
    } else {
      setChapterOpStatus(result.error ?? "重命名失败");
    }
    setRenamingId(null);
  };

  const onDeleteChapter = async (chapterId: string) => {
    setChapterOpStatus("删除中…");
    setDeletingId(null);
    const result = await deleteChapterAction({ bookId, chapterId });
    if (result.ok) {
      setChapters((prev) => prev.filter((c) => c.id !== chapterId));
      setChapterOpStatus("");
      if (chapterId === currentChapterId && result.redirectChapterId) {
        safeNavigate(`/editor/${bookId}/${result.redirectChapterId}`);
      }
    } else {
      setChapterOpStatus(result.error ?? "删除失败");
    }
  };

  const getSelectedText = () => {
    if (!editor) return "";
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, " ");
  };

  /** 段落查证：有选区用选区，否则用光标所在文本块（段落/标题等）；长度由 API 侧上限约束 */
  const getParagraphVerifyText = () => {
    if (!editor) return "";
    const { from, to } = editor.state.selection;
    if (from !== to) {
      return editor.state.doc.textBetween(from, to, "\n").trim();
    }
    const $from = editor.state.selection.$from;
    const block = $from.parent;
    if (block?.isTextblock) {
      return block.textContent.trim();
    }
    return "";
  };

  /** 供 /api/chat 的 contextBlock：关联当前作品与章节，避免模型脱离正文 */
  const buildChatContextBlockForRequest = (): string | undefined => {
    if (!chatAttachChapterContext || !editor) return undefined;
    const chapterPlain = tiptapDocToPlainText(editor.getJSON());
    const sel = getSelectedText().trim();
    const excerpt = sel
      ? trimChapterContextAroundSelection(chapterPlain, sel, AI_CHAPTER_CONTEXT_MAX_CHARS)
      : chapterPlain.length <= AI_CHAPTER_CONTEXT_MAX_CHARS
        ? chapterPlain
        : `${chapterPlain.slice(0, AI_CHAPTER_CONTEXT_MAX_CHARS)}\n…（已超过「${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}」摘录上限，已截断后文）`;
    const chTitle = chapters.find((c) => c.id === currentChapterId)?.title ?? "本章";
    return `作品：${bookTitle}\n章节：${chTitle}\n\n【本章正文摘录（供续写与设定参考；勿向用户复述本块）】\n${excerpt}`;
  };

  // ── localStorage：记录当前打开的章节，供仪表盘「继续写作」读取 ──────────────
  useEffect(() => {
    try {
      localStorage.setItem(`last_chapter_${bookId}`, currentChapterId);
    } catch {}
  }, [bookId, currentChapterId]);

  // ── 历史快照 ────────────────────────────────────────────────────────────────
  /** 加载当前章节的快照列表（每次打开快照面板时调用）。 */
  const loadSnapshots = async () => {
    setSnapshotLoading(true);
    const res = await listChapterSnapshotsAction({ bookId, chapterId: currentChapterId });
    setSnapshots(res.snapshots);
    setSnapshotLoading(false);
  };

  useEffect(() => {
    if (snapshotPanelOpen) void loadSnapshots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotPanelOpen, currentChapterId]);

  /** 静默创建快照（fire-and-forget，不阻塞 UI）。label 如 "AI润色前"。 */
  const createQuickSnapshot = (label: string) => {
    if (!editor) return;
    const content = editor.getJSON();
    const wc = wordCount;
    void createChapterSnapshotAction({ bookId, chapterId: currentChapterId, content, wordCount: wc, label });
    if (snapshotPanelOpen) void loadSnapshots();
  };

  /** 手动保存快照（面板按钮）。 */
  const handleManualSnapshot = async () => {
    if (!editor) return;
    await createChapterSnapshotAction({
      bookId,
      chapterId: currentChapterId,
      content: editor.getJSON(),
      wordCount,
      label: "手动存档"
    });
    await loadSnapshots();
    toast.success("快照已保存");
  };

  /** 恢复快照：先快照当前状态，再把快照内容写入编辑器（不自动保存到 DB，需用户手动保存）。 */
  const handleRestoreSnapshot = async (snapshotId: string) => {
    if (!editor) return;
    setSnapshotRestoring(snapshotId);
    // 先备份当前状态
    await createChapterSnapshotAction({
      bookId, chapterId: currentChapterId,
      content: editor.getJSON(), wordCount, label: "恢复前自动备份"
    });
    const res = await restoreChapterSnapshotAction({ bookId, chapterId: currentChapterId, snapshotId });
    if (!res.ok || !res.content) {
      toast.error("恢复失败，请重试。");
      setSnapshotRestoring(null);
      return;
    }
    // 写入编辑器（不提交数据库，用户看到内容变化后可选择保存）
    editor.commands.setContent(res.content as JSONContent);
    setWordCount(res.wordCount ?? 0);
    setSaveState("error"); // 标记为有未保存修改
    setSnapshotRestoring(null);
    await loadSnapshots();
    toast.success("已恢复至该快照，内容已写入编辑区，请点击保存确认。");
  };

  const handleDeleteSnapshot = async (snapshotId: string) => {
    const res = await deleteChapterSnapshotAction({ snapshotId });
    if (!res.ok) { toast.error("删除快照失败，请重试。"); return; }
    setSnapshots((prev) => prev.filter((s) => s.id !== snapshotId));
  };

  // 记录发起 AI 操作时的选区位置，防止异步返回后选区已漂移
  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null);

  const saveCurrentSelection = () => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    savedSelectionRef.current = { from, to };
  };

  const replaceSelection = (replacement: string) => {
    if (!editor) return;
    const range = savedSelectionRef.current ?? editor.state.selection;
    const { from, to } = range;
    editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    savedSelectionRef.current = null;
    setSelectedCount(0);
  };

  const runAiReview = async (targetText: string) => {
    const reviewRes = await fetch("/api/ai/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: targetText })
    });
    return (await reviewRes.json()) as { ok?: boolean; pass?: boolean; reason?: string };
  };

  const handleGenerateError = (
    generateJson: {
      error_code?: string;
      message?: string;
      risk_action?: "warning" | "banned";
    }
  ): boolean => {
    const code = generateJson.error_code;
    if (code === "UNAUTHORIZED") { setAiMessage("登录状态已失效，请重新登录。"); setCanRetryAi(false); return true; }
    if (code === "FORBIDDEN") { setAiMessage(generateJson.message || "审核未通过，已阻断生成。"); setCanRetryAi(false); return true; }
    if (code === "INSUFFICIENT_BALANCE") {
      setAiMessage(generateJson.message || "字数额度不足，请点击顶部钱包兑换激活码。");
      setCanRetryAi(false);
      return true;
    }
    if (code === "DAILY_OUTPUT_CAP") {
      setAiMessage(generateJson.message || "本日生成已达上限，请明日再试。");
      setCanRetryAi(false);
      return true;
    }
    if (code === "QUOTA_ADMIN_HOLD") {
      setAiMessage(generateJson.message || "账号已临时限制 AI 生成，请联系管理员。");
      setCanRetryAi(false);
      return true;
    }
    if (code === "BILLING_UNAVAILABLE") {
      setAiMessage(generateJson.message || "计费服务暂时不可用，请稍后再试或联系管理员。");
      setCanRetryAi(true);
      return true;
    }
    if (code === "MODEL_NOT_FOUND" || code === "MODEL_ACTION_MISMATCH") {
      setAiMessage(generateJson.message || "当前模型不可用，请更换工具栏中的模型。");
      setCanRetryAi(false);
      return true;
    }
    if (code === "DIFY_TIMEOUT" || code === "RATE_LIMITED") { setAiMessage("服务暂时繁忙，请稍后重试。"); setCanRetryAi(true); return true; }
    if (code === "PROMPT_NOT_FOUND" || code === "PROMPT_INACTIVE") { setAiMessage("提示词配置缺失或未启用，请联系管理员。"); setCanRetryAi(false); return true; }
    return false;
  };

  /** 润色：snippet=请求里只有选段；chapter=附带本章正文（编辑器当前全文）并校验章节隶属作品 */
  const runPolish = async (mode: "snippet" | "chapter") => {
    if (!editor) return;
    const selected = getSelectedText().trim();
    if (!selected) { setAiMessage("请先选中文本再执行润色。"); return; }
    saveCurrentSelection();

    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const ctxLen = mode === "chapter" ? Math.min(tiptapDocToPlainText(editor.getJSON()).length, 6000) : 0;
    const userInputChars = selected.length + ctxLen;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("polish", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "润色",
      pool,
      modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setAiStatus("running");
    setAiMessage(mode === "chapter" ? "AI 正结合本章语境润色…" : "AI 正在润色…");
    setLastAiAction(mode === "chapter" ? { kind: "polish_chapter" } : { kind: "polish_snippet" });
    setCanRetryAi(false);

    try {
      const review = await runAiReview(selected);
      if (!review.pass) { setAiMessage(review.reason || "审核未通过，已阻断生成。"); return; }

      const body =
        mode === "snippet"
          ? {
              userText: `请对以下文本执行润色，仅输出处理后文本，不要解释：\n${selected}`,
              action_type: AI_ACTION_POLISH,
              model_key: selectedModelKey,
              book_id: bookId,
              polish_mode: "snippet"
            }
          : {
              userText: "",
              action_type: AI_ACTION_POLISH,
              model_key: selectedModelKey,
              book_id: bookId,
              polish_mode: "chapter",
              selected_text: selected,
              chapter_plain_context: tiptapDocToPlainText(editor.getJSON()),
              chapter_id: currentChapterId
            };

      const generateRes = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const generateJson = (await generateRes.json()) as {
        ok?: boolean; answer?: string; error_code?: string;
        risk_action?: "warning" | "banned"; message?: string;
        billing?: { kind?: string; detail?: string };
      };

      if (!generateRes.ok || !generateJson.ok) {
        if (!handleGenerateError(generateJson)) {
          setAiMessage(generateJson.message || "生成失败，请稍后重试。");
          setCanRetryAi(true);
        }
        return;
      }
      createQuickSnapshot("润色前自动备份");
      replaceSelection(generateJson.answer || selected);
      const bill = generateJson.billing?.detail;
      const done =
        mode === "chapter" ? "已完成润色（结合本章上下文）并替换选区。" : "已完成润色（仅选段）并替换选区。";
      setAiMessage(bill ? `${done}\n${bill}` : done);
      setCanRetryAi(false);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      setAiMessage("网络异常，请重试。");
      setCanRetryAi(true);
    } finally {
      setAiStatus("idle");
    }
  };

  /** 扩写：snippet=仅选段；chapter=附带本章正文语境 */
  const runExpand = async (mode: "snippet" | "chapter") => {
    if (!editor) return;
    const selected = getSelectedText().trim();
    if (!selected) { setAiMessage("请先选中文本再执行扩写。"); return; }
    saveCurrentSelection();

    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const ctxLen = mode === "chapter" ? Math.min(tiptapDocToPlainText(editor.getJSON()).length, 6000) : 0;
    const userInputChars = selected.length + ctxLen;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("expand", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "扩写",
      pool,
      modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setAiStatus("running");
    setAiMessage(mode === "chapter" ? "AI 正结合本章语境扩写…" : "AI 正在扩写…");
    setLastAiAction(mode === "chapter" ? { kind: "expand_chapter" } : { kind: "expand_snippet" });
    setCanRetryAi(false);

    try {
      const review = await runAiReview(selected);
      if (!review.pass) { setAiMessage(review.reason || "审核未通过，已阻断生成。"); return; }

      const body =
        mode === "snippet"
          ? {
              userText: `请对以下文本执行扩写，仅输出处理后文本，不要解释：\n${selected}`,
              action_type: AI_ACTION_EXPAND,
              model_key: selectedModelKey,
              book_id: bookId,
              expand_mode: "snippet"
            }
          : {
              userText: "",
              action_type: AI_ACTION_EXPAND,
              model_key: selectedModelKey,
              book_id: bookId,
              expand_mode: "chapter",
              selected_text: selected,
              chapter_plain_context: tiptapDocToPlainText(editor.getJSON()),
              chapter_id: currentChapterId
            };

      const generateRes = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const generateJson = (await generateRes.json()) as {
        ok?: boolean; answer?: string; error_code?: string;
        risk_action?: "warning" | "banned"; message?: string;
        billing?: { kind?: string; detail?: string };
      };

      if (!generateRes.ok || !generateJson.ok) {
        if (!handleGenerateError(generateJson)) {
          setAiMessage(generateJson.message || "生成失败，请稍后重试。");
          setCanRetryAi(true);
        }
        return;
      }
      createQuickSnapshot("扩写前自动备份");
      replaceSelection(generateJson.answer || selected);
      const bill = generateJson.billing?.detail;
      const done =
        mode === "chapter" ? "已完成扩写（结合本章上下文）并替换选区。" : "已完成扩写（仅选段）并替换选区。";
      setAiMessage(bill ? `${done}\n${bill}` : done);
      setCanRetryAi(false);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      setAiMessage("网络异常，请重试。");
      setCanRetryAi(true);
    } finally {
      setAiStatus("idle");
    }
  };

  /** 去痕：snippet=仅选段；chapter=附带本章正文语境 */
  const runDeAi = async (mode: "snippet" | "chapter") => {
    if (!editor) return;
    const selected = getSelectedText().trim();
    if (!selected) { setAiMessage("请先选中文本再执行去痕。"); return; }
    saveCurrentSelection();

    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const ctxLen = mode === "chapter" ? Math.min(tiptapDocToPlainText(editor.getJSON()).length, 6000) : 0;
    const userInputChars = selected.length + ctxLen;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("de_ai", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "去 AI 痕迹",
      pool,
      modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setAiStatus("running");
    setAiMessage(mode === "chapter" ? "AI 正结合本章语境去痕…" : "AI 正在去痕…");
    setLastAiAction(mode === "chapter" ? { kind: "de_ai_chapter" } : { kind: "de_ai_snippet" });
    setCanRetryAi(false);

    try {
      const review = await runAiReview(selected);
      if (!review.pass) { setAiMessage(review.reason || "审核未通过，已阻断生成。"); return; }

      const body =
        mode === "snippet"
          ? {
              userText: `请对以下文本执行去痕，仅输出处理后文本，不要解释：\n${selected}`,
              action_type: AI_ACTION_DE_AI,
              model_key: selectedModelKey,
              book_id: bookId,
              de_ai_mode: "snippet"
            }
          : {
              userText: "",
              action_type: AI_ACTION_DE_AI,
              model_key: selectedModelKey,
              book_id: bookId,
              de_ai_mode: "chapter",
              selected_text: selected,
              chapter_plain_context: tiptapDocToPlainText(editor.getJSON()),
              chapter_id: currentChapterId
            };

      const generateRes = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const generateJson = (await generateRes.json()) as {
        ok?: boolean; answer?: string; error_code?: string;
        risk_action?: "warning" | "banned"; message?: string;
        billing?: { kind?: string; detail?: string };
      };

      if (!generateRes.ok || !generateJson.ok) {
        if (!handleGenerateError(generateJson)) {
          setAiMessage(generateJson.message || "生成失败，请稍后重试。");
          setCanRetryAi(true);
        }
        return;
      }
      createQuickSnapshot("去痕前自动备份");
      replaceSelection(generateJson.answer || selected);
      const bill = generateJson.billing?.detail;
      const done =
        mode === "chapter" ? "已完成去痕（结合本章上下文）并替换选区。" : "已完成去痕（仅选段）并替换选区。";
      setAiMessage(bill ? `${done}\n${bill}` : done);
      setCanRetryAi(false);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      setAiMessage("网络异常，请重试。");
      setCanRetryAi(true);
    } finally {
      setAiStatus("idle");
    }
  };

  const retryLastGenerate = async () => {
    if (!lastAiAction) return;
    if (lastAiAction.kind === "polish_snippet") await runPolish("snippet");
    else if (lastAiAction.kind === "polish_chapter") await runPolish("chapter");
    else if (lastAiAction.kind === "expand_snippet") await runExpand("snippet");
    else if (lastAiAction.kind === "expand_chapter") await runExpand("chapter");
    else if (lastAiAction.kind === "de_ai_snippet") await runDeAi("snippet");
    else await runDeAi("chapter");
  };

  const runBrainstormOutline = async () => {
    const ip = brainstormIp.trim();
    const character = brainstormCharacter.trim();
    const timeline = brainstormTimeline.trim();
    if (!ip || !character || !timeline) {
      toast.error("请填写 IP、角色、时间线（均为必填）。");
      return;
    }

    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const userInputChars = ip.length + character.length + timeline.length;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("brainstorm", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "脑洞生成",
      pool,
      modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setBrainstormDialogOpen(false);
    setBrainstormStatus("running");
    setBrainstormMessage("生成中…");
    setBrainstormResult("");
    const out = await fetchBrainstormOutline({
      bookId,
      ip,
      character,
      timeline,
      model_key: selectedModelKey
    });
    if (!out.ok) {
      setBrainstormMessage(messageForBrainstormFailure(out));
      setBrainstormStatus("idle");
      return;
    }
    setBrainstormResult(out.answer);
    setBrainstormMessage(out.billingDetail ? `生成完成。\n${out.billingDetail}` : "生成完成。");
    window.dispatchEvent(new Event("ai:balance-changed"));
    setBrainstormStatus("idle");
  };

  const insertPlainTextAsParagraphs = (text: string, successToast?: string) => {
    if (!editor || !text.trim()) return;
    editor.chain().focus().insertContent(plainTextToTipTapParagraphs(text)).run();
    if (successToast) toast.success(successToast);
  };

  const insertBrainstormIntoEditor = () => {
    insertPlainTextAsParagraphs(brainstormResult, "已插入到正文");
  };

  const loadKbItems = async () => {
    setKbLoading(true);
    setKbError(null);
    const out = await fetchKnowledgeItems(bookId);
    setKbLoading(false);
    if (!out.ok) {
      setKbError(
        out.error_code === "TABLE_UNAVAILABLE"
          ? messageForKnowledgeSaveFailure(out)
          : out.message || "加载失败"
      );
      setKbItems([]);
      return;
    }
    setKbItems(out.items);
  };

  const deleteKbItem = async (id: string) => {
    const out = await deleteKnowledgeItem(id);
    if (!out.ok) { toast.error(out.message || "删除失败"); return; }
    toast.success("已删除");
    setKbItems((prev) => prev.filter((x) => x.id !== id));
  };

  const saveBrainstormToKnowledge = async () => {
    const text = brainstormResult.trim();
    if (!text) return;
    const title = [
      "脑洞",
      brainstormIp.trim() && `IP：${brainstormIp.trim()}`,
      brainstormCharacter.trim() && `角色：${brainstormCharacter.trim()}`,
      brainstormTimeline.trim() && `时间线：${brainstormTimeline.trim()}`
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500);
    setBrainstormKbSaving(true);
    const out = await saveKnowledgeItem({
      bookId,
      content: text,
      title: title || undefined,
      type: "brainstorm",
      tags: ["脑洞"]
    });
    setBrainstormKbSaving(false);
    if (!out.ok) {
      toast.error(messageForKnowledgeSaveFailure(out));
      return;
    }
    toast.success("已加入知识库");
  };

  const runParagraphVerify = async () => {
    const target = getParagraphVerifyText();
    if (!target) {
      toast.error("请先选中一段文字，或将光标放在某个段落内。");
      return;
    }

    const m = availableModels.find((x) => x.model_key === selectedModelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const userInputChars = target.length;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("verify", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "段落查证",
      pool,
      modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setVerifyRunning(true);
    setVerifyAnswer("");
    setVerifyBillingLine("");
    try {
      const res = await fetch("/api/ai/paragraph-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          userText: target,
          model_key: selectedModelKey
        })
      });
      const json = (await res.json()) as {
        ok?: boolean;
        answer?: string;
        message?: string;
        billing?: { detail?: string };
      };
      if (!res.ok || !json.ok) {
        toast.error(json.message || "段落查证失败");
        return;
      }
      setVerifyAnswer(json.answer || "");
      setVerifyBillingLine(json.billing?.detail ?? "");
      setVerifyDialogOpen(true);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setVerifyRunning(false);
    }
  };

  const onAiReviewClick = async () => {
    if (!editor) return;
    const selected = getSelectedText().trim();
    if (!selected) { setAiMessage("请先选中文本再审稿。"); return; }
    setAiStatus("running");
    setAiMessage("审稿中...");
    try {
      const review = await runAiReview(selected);
      setAiMessage(review.pass ? "审稿通过，可继续生成。" : review.reason || "审稿未通过。");
    } catch { setAiMessage("审稿失败，请稍后重试。"); }
    finally { setAiStatus("idle"); }
  };

  const sendChatMessage = async (retryMessage?: string) => {
    const message = (retryMessage ?? chatInput).trim();
    if (!message) return;
    if (!canEditChapter) return;

    // 重试时不再二次弹窗
    if (!retryMessage) {
      const m = availableModels.find((x) => x.model_key === selectedModelKey);
      const pool = m?.word_pool === "pro" ? "pro" : "flash";
      const ctx = buildChatContextBlockForRequest();
      const userInputChars = message.length + (ctx?.length ?? 0);
      const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("chat", userInputChars);
      const confirmed = await confirmAiCall({
        operation: "侧栏聊天续写",
        pool,
        modelName: selectedModelKey === "default" ? "默认模型" : (m?.name ?? selectedModelKey),
        userInputChars,
        sysPromptMin,
        sysPromptMax,
        outputMin,
        outputMax
      });
      if (!confirmed) return;
    }

    setChatStatus("sending");
    setChatError("");
    setChatBillingNote("");
    setChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: message }]);
    if (!retryMessage) setChatInput("");

    try {
      const abortController = new AbortController();
      chatAbortRef.current = abortController;
      const ctx = buildChatContextBlockForRequest();
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortController.signal,
        body: JSON.stringify({
          bookId,
          message,
          conversationId: chatConversationId || undefined,
          contextBlock: ctx,
          model_key: selectedModelKey
        })
      });
      const result = (await response.json()) as {
        ok?: boolean; answer?: string; conversationId?: string;
        error_code?: string; risk_action?: "warning" | "banned"; message?: string;
        billing?: { detail?: string };
      };

      if (!response.ok || !result.ok) {
        const code = result.error_code;
        if (code === "UNAUTHORIZED") { setChatError("登录状态已失效，请重新登录。"); return; }
        if (code === "FORBIDDEN") {
          setChatError(result.risk_action === "banned"
            ? "账号已被封禁，请前往封禁说明页提交申诉。"
            : result.message || "内容命中安全规则，本次请求已阻断。");
          return;
        }
        if (code === "INSUFFICIENT_BALANCE") {
          setChatError(result.message || "字数额度不足，请点击顶部钱包兑换激活码。");
          return;
        }
        if (code === "DAILY_OUTPUT_CAP") {
          setChatError(result.message || "本日生成已达上限，请明日再试。");
          return;
        }
        if (code === "QUOTA_ADMIN_HOLD") {
          setChatError(result.message || "账号已临时限制 AI 生成，请联系管理员。");
          return;
        }
        if (code === "BILLING_UNAVAILABLE") {
          setChatError(result.message || "计费服务暂时不可用，请稍后再试或联系管理员。");
          return;
        }
        if (code === "MODEL_NOT_FOUND") {
          setChatError(result.message || "聊天模型不可用，请切换工具栏模型或联系管理员。");
          return;
        }
        if (code === "RATE_LIMITED" || code === "DIFY_TIMEOUT") { setChatError("AI 服务繁忙，请稍后重试。"); return; }
        if (code === "PROMPT_NOT_FOUND" || code === "PROMPT_INACTIVE") { setChatError("聊天提示词配置缺失，请联系管理员。"); return; }
        setChatError(result.message || "聊天失败，请重试。");
        return;
      }
      if (result.conversationId) setChatConversationId(result.conversationId);
      setChatMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: result.answer || "" }]);
      setChatBillingNote(result.billing?.detail ?? "");
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch { setChatError("网络异常，聊天发送失败。"); }
    finally { chatAbortRef.current = null; setChatStatus("idle"); }
  };

  const stopChatGenerating = () => {
    if (chatAbortRef.current) {
      chatAbortRef.current.abort();
      chatAbortRef.current = null;
      setChatStatus("idle");
      setChatError("已停止本次生成。");
    }
  };

  const insertAssistantText = (content: string, mode: "cursor" | "append") => {
    if (!canEditChapter || !editor || !content.trim()) return;
    if (mode === "cursor") { editor.chain().focus().insertContent(content).run(); return; }
    editor.chain().focus("end").insertContent(`\n${content}`).run();
  };

  const clearChatDisplay = () => {
    setChatMessages([]);
    setChatError("");
    setChatBillingNote("");
    try { window.localStorage.removeItem(`chat:${bookId}`); } catch {}
  };

  const deleteAllQuotes = () => {
    if (!editor) return;
    const quotePattern = /[''ʼ`]/;
    const positions: { from: number; to: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (!node.isText || !node.text) return;
      for (let i = 0; i < node.text.length; i++) {
        if (quotePattern.test(node.text[i])) {
          positions.push({ from: pos + i, to: pos + i + 1 });
        }
      }
    });
    if (positions.length === 0) return;
    const tr = editor.state.tr;
    for (let i = positions.length - 1; i >= 0; i--) tr.delete(positions[i].from, positions[i].to);
    editor.view.dispatch(tr);
  };

  const fontCss = FONT_FAMILIES.find((f) => f.key === fontFamily)?.css ?? "inherit";

  const exportCurrentChapterTxt = () => {
    if (!editor) {
      setChapterOpStatus("编辑器未就绪");
      return;
    }
    const ch = chapters.find((c) => c.id === currentChapterId);
    const chTitle = ch?.title ?? "章节";
    const body = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
    const header = `《${bookTitle}》\n【${chTitle}】\n\n`;
    const day = new Date().toISOString().slice(0, 10);
    const filename = `${sanitizeFilenameSegment(chTitle)}_${day}.txt`;
    downloadTextFile(filename, header + body);
    setChapterOpStatus("已导出本章 .txt（含当前编辑区未保存内容）");
    window.setTimeout(() => setChapterOpStatus(""), 3200);
  };

  const exportFullBookTxt = async () => {
    setChapterOpStatus("正在生成全书文本…");
    const res = await exportFullBookPlainTextAction(bookId);
    if (!res.ok) {
      setChapterOpStatus(res.error);
      return;
    }
    downloadTextFile(res.filename, res.text);
    setChapterOpStatus(`已下载：${res.filename}`);
    window.setTimeout(() => setChapterOpStatus(""), 4000);
  };

  const exportCurrentChapterMd = () => {
    if (!editor) {
      setChapterOpStatus("编辑器未就绪");
      return;
    }
    const ch = chapters.find((c) => c.id === currentChapterId);
    const chTitle = ch?.title ?? "章节";
    const body = tiptapDocToMarkdown(editor.getJSON());
    const text = `# 《${bookTitle}》\n\n## ${chTitle}\n\n${body}\n`;
    const day = new Date().toISOString().slice(0, 10);
    downloadTextFile(`${sanitizeFilenameSegment(chTitle)}_${day}.md`, text);
    setChapterOpStatus("已导出本章 .md（含当前编辑区未保存内容）");
    window.setTimeout(() => setChapterOpStatus(""), 3200);
  };

  const exportCurrentChapterDocx = async () => {
    if (!editor) {
      setChapterOpStatus("编辑器未就绪");
      return;
    }
    const ch = chapters.find((c) => c.id === currentChapterId);
    const chTitle = ch?.title ?? "章节";
    setChapterOpStatus("正在生成本章 Word…");
    const res = await exportChapterDocxFromEditorAction({
      bookId,
      bookTitle,
      chapterTitle: chTitle,
      content: editor.getJSON()
    });
    if (!res.ok) {
      setChapterOpStatus(res.error);
      return;
    }
    downloadBase64File(
      res.filename,
      res.base64,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    setChapterOpStatus(`已下载：${res.filename}`);
    window.setTimeout(() => setChapterOpStatus(""), 4000);
  };

  const exportFullBookMd = async () => {
    setChapterOpStatus("正在生成全书 Markdown…");
    const res = await exportFullBookMarkdownAction(bookId);
    if (!res.ok) {
      setChapterOpStatus(res.error);
      return;
    }
    downloadTextFile(res.filename, res.text);
    setChapterOpStatus(`已下载：${res.filename}`);
    window.setTimeout(() => setChapterOpStatus(""), 4000);
  };

  const exportFullBookDocx = async () => {
    setChapterOpStatus("正在生成全书 Word…");
    const res = await exportFullBookDocxAction(bookId);
    if (!res.ok) {
      setChapterOpStatus(res.error);
      return;
    }
    downloadBase64File(
      res.filename,
      res.base64,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    setChapterOpStatus(`已下载：${res.filename}`);
    window.setTimeout(() => setChapterOpStatus(""), 4000);
  };

  const toolbarBtn = (active: boolean) =>
    `rounded border px-1.5 py-0.5 text-xs ${active ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 hover:bg-slate-50"}`;

  const blockingAi = aiStatus === "running" || brainstormStatus === "running" || verifyRunning;
  const aiBlocked = blockingAi || !canEditChapter;

  const renderChatPanel = (
    variant: "sidebar" | "drawer",
    drawerOpts?: { onClose: () => void }
  ) => {
    const rootCls =
      variant === "sidebar"
        ? "mt-4 rounded-xl border border-slate-200 p-3"
        : "rounded-xl border-0 bg-white p-3 shadow-none";
    const msgScrollCls =
      variant === "sidebar" ? "max-h-64" : "max-h-[min(50vh,26rem)]";
    return (
      <div className={rootCls}>
        {variant === "drawer" ? (
          <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2">
            <p id="immersive-chat-title" className="text-sm font-semibold text-slate-800">
              AI 聊天续写
            </p>
            <button
              type="button"
              onClick={() => drawerOpts?.onClose()}
              className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50"
            >
              关闭
            </button>
          </div>
        ) : null}
        <div
          className={`flex flex-wrap items-center gap-2 ${variant === "sidebar" ? "justify-between" : "justify-start"}`}
        >
          {variant === "sidebar" ? (
            <p className="text-xs font-semibold text-slate-700">AI 聊天续写</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-[11px] text-slate-600">
              <input
                type="checkbox"
                checked={chatAttachChapterContext}
                onChange={(e) => setChatAttachChapterContext(e.target.checked)}
                className="rounded border-slate-300"
              />
              附带本章摘录
            </label>
            <button
              type="button"
              onClick={clearChatDisplay}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-slate-50"
            >
              清空显示
            </button>
          </div>
        </div>
        {chatAttachChapterContext ? (
          <div className="mt-2 rounded-md border border-amber-100 bg-amber-50/90 px-2 py-1.5 text-[11px] leading-snug text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/35 dark:text-amber-100">
            <p className="font-medium">本章摘录上限 {AI_CHAPTER_CONTEXT_MAX_USER_LABEL}</p>
            <p className="mt-0.5 text-[10px] text-amber-900/90 dark:text-amber-100/85">
              {AI_CHAPTER_CONTEXT_LIMIT_HINT}有选区时围绕选段开窗，无选区时从章首截取；与工具栏所选模型一致。
            </p>
          </div>
        ) : null}
        {!canEditChapter ? (
          <p className="mt-1 text-[11px] text-slate-500">
            当前为只读浏览：请用桌面端或点顶部横幅「仍要在此设备编辑」后再使用聊天与插入正文。
          </p>
        ) : null}
        {chatBillingNote ? (
          <p className="mt-2 whitespace-pre-line rounded-md border border-emerald-100 bg-emerald-50/80 px-2 py-1.5 text-[11px] text-emerald-900">
            {chatBillingNote}
          </p>
        ) : null}
        <div className={`mt-2 space-y-2 overflow-y-auto pr-1 ${msgScrollCls}`}>
          {chatMessages.length ? (
            chatMessages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-md px-2 py-1 text-xs ${msg.role === "user" ? "bg-slate-100 text-slate-700" : "bg-indigo-50 text-indigo-700"}`}
              >
                {msg.role === "user" ? "我" : "AI"}：{msg.content}
                {msg.role === "assistant" ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <button
                      type="button"
                      onClick={() => insertAssistantText(msg.content, "cursor")}
                      disabled={!canEditChapter}
                      className="rounded border border-indigo-200 px-1.5 py-0.5 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      插入光标
                    </button>
                    <button
                      type="button"
                      onClick={() => insertAssistantText(msg.content, "append")}
                      disabled={!canEditChapter}
                      className="rounded border border-indigo-200 px-1.5 py-0.5 text-[11px] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      追加章末
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-xs text-slate-400">发送一句话，开始多轮续写。</p>
          )}
        </div>
        {chatError ? (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-rose-600">{chatError}</p>
            <button
              type="button"
              onClick={() => {
                const lastUser = [...chatMessages].reverse().find((m) => m.role === "user");
                if (lastUser?.content) void sendChatMessage(lastUser.content);
              }}
              disabled={chatStatus === "sending" || !canEditChapter}
              className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-60"
            >
              重试
            </button>
          </div>
        ) : null}
        <div className="mt-2 flex items-center gap-2">
          <input
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            readOnly={!canEditChapter}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void sendChatMessage();
              }
            }}
            placeholder="问 AI：下一段怎么写？"
            className={`w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none ring-indigo-200 focus:ring ${!canEditChapter ? "cursor-not-allowed bg-slate-50 text-slate-500" : ""}`}
          />
          <button
            type="button"
            onClick={() => void sendChatMessage()}
            disabled={chatStatus === "sending" || !canEditChapter}
            className="rounded bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60"
          >
            发送
          </button>
          <button
            type="button"
            onClick={stopChatGenerating}
            disabled={chatStatus !== "sending"}
            className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
          >
            停止
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
    {aiConfirmDialog}
    <Dialog open={brainstormDialogOpen} onOpenChange={setBrainstormDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>脑洞生成</DialogTitle>
          <DialogDescription>
            固定三项（IP、角色、时间线），无第四项与高级扩展。生成后可「加入知识库」或「插入正文」；提交按当前工具栏模型计费。
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-xs font-medium text-slate-700">IP</label>
            <textarea
              value={brainstormIp}
              onChange={(e) => setBrainstormIp(e.target.value)}
              placeholder="例如：作品名 / 原作设定"
              disabled={aiBlocked}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none ring-violet-100 focus:ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">角色</label>
            <textarea
              value={brainstormCharacter}
              onChange={(e) => setBrainstormCharacter(e.target.value)}
              placeholder="主要角色、关系或出场设定"
              disabled={aiBlocked}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none ring-violet-100 focus:ring"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-700">时间线</label>
            <textarea
              value={brainstormTimeline}
              onChange={(e) => setBrainstormTimeline(e.target.value)}
              placeholder="原作时间线、段落节点或 AU 前提"
              disabled={aiBlocked}
              rows={3}
              className="mt-1 w-full resize-y rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none ring-violet-100 focus:ring"
            />
          </div>
          <button
            type="button"
            onClick={() => void runBrainstormOutline()}
            disabled={aiBlocked}
            className="w-full rounded-md bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {brainstormStatus === "running" ? "生成中…" : "开始生成"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
    <Dialog open={verifyDialogOpen} onOpenChange={setVerifyDialogOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>段落查证结果</DialogTitle>
          <DialogDescription>
            仅供参考，请结合原作与常识人工复核。后台已开启联网时，创作引擎可尝试检索公开信息辅助判断。
          </DialogDescription>
        </DialogHeader>
        {verifyBillingLine ? (
          <p className="rounded-md border border-emerald-100 bg-emerald-50/80 px-2 py-1.5 text-[11px] text-emerald-900 whitespace-pre-line">
            {verifyBillingLine}
          </p>
        ) : null}
        <pre className="mt-3 max-h-[55vh] overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
          {verifyAnswer || "（无内容）"}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              insertPlainTextAsParagraphs(`【段落查证】\n${verifyAnswer}`, "已插入正文");
            }}
            disabled={!editor || !verifyAnswer.trim()}
            className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-900 hover:bg-indigo-100 disabled:opacity-60"
          >
            插入到正文
          </button>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(verifyAnswer).then(() => toast.success("已复制"))}
            disabled={!verifyAnswer.trim()}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-60"
          >
            复制全文
          </button>
        </div>
      </DialogContent>
    </Dialog>
    <div className={`mx-auto grid max-w-7xl gap-4 p-4 ${immersive ? "grid-cols-1" : "min-h-[calc(100vh-56px)] grid-cols-12"}`}>
      {/* ── Left sidebar: chapters ── */}
      {!immersive && (
        <aside className="col-span-3 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 border-b border-slate-100 pb-3">
            <p className="truncate text-sm font-semibold text-slate-900" title={bookTitle}>
              {bookTitle}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-500">章节目录</p>
          </div>
          <div className="mb-3 flex items-center justify-end">
            <button
              onClick={onCreateChapter}
              disabled={isPending}
              className="rounded-md bg-indigo-600 px-2 py-1 text-xs text-white disabled:opacity-60"
            >
              + 章节
            </button>
          </div>
          {chapterOpStatus ? (
            <p className="mb-2 text-xs text-amber-600">{chapterOpStatus}</p>
          ) : null}
          <div className="space-y-1">
            {chapters.map((chapter) => (
              <div
                key={chapter.id}
                className="group relative"
                draggable
                onDragStart={(e) => {
                  dragSrcId.current = chapter.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const srcId = dragSrcId.current;
                  if (!srcId || srcId === chapter.id) return;
                  setChapters((prev) => {
                    const arr = [...prev];
                    const fromIdx = arr.findIndex((c) => c.id === srcId);
                    const toIdx = arr.findIndex((c) => c.id === chapter.id);
                    if (fromIdx === -1 || toIdx === -1) return prev;
                    const [item] = arr.splice(fromIdx, 1);
                    arr.splice(toIdx, 0, item);
                    const reindexed = arr.map((c, i) => ({ ...c, order_index: i + 1 }));
                    void reorderChaptersAction({ bookId, orderedIds: reindexed.map((c) => c.id) });
                    return reindexed;
                  });
                  dragSrcId.current = null;
                }}
              >
                {renamingId === chapter.id ? (
                  <div className="flex gap-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void onRenameChapter(chapter.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 rounded border border-indigo-300 px-2 py-1 text-xs outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void onRenameChapter(chapter.id)}
                      className="rounded bg-indigo-600 px-1.5 py-0.5 text-xs text-white"
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:bg-slate-50"
                    >
                      ✕
                    </button>
                  </div>
                ) : deletingId === chapter.id ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs">
                    <p className="mb-1 text-rose-700">确认删除「{chapter.title}」？</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => void onDeleteChapter(chapter.id)}
                        className="rounded bg-rose-600 px-2 py-0.5 text-white"
                      >
                        删除
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(null)}
                        className="rounded border border-slate-200 bg-white px-2 py-0.5 hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start">
                    <button
                      type="button"
                      onClick={() => {
                        if (chapter.id !== currentChapterId) safeNavigate(`/editor/${bookId}/${chapter.id}`);
                      }}
                      className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm ${
                        chapter.id === currentChapterId
                          ? "bg-indigo-50 text-indigo-700"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate font-medium">{chapter.title}</span>
                        <span className="shrink-0 tabular-nums text-[11px] font-normal text-slate-400">
                          {(chapter.id === currentChapterId ? wordCount : chapter.word_count) ?? 0} 字
                        </span>
                      </div>
                      <p
                        className={`mt-0.5 text-[10px] leading-tight ${
                          chapter.id === currentChapterId ? "text-indigo-600/80" : "text-slate-400"
                        }`}
                      >
                        {formatChapterSidebarMeta(chapter.order_index, chapter.created_at)}
                      </p>
                    </button>
                    <div className="ml-1 flex shrink-0 gap-0.5 self-center opacity-0 transition group-hover:opacity-100">
                      <button
                        type="button"
                        title="重命名"
                        onClick={() => { setRenamingId(chapter.id); setRenameValue(chapter.title); }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="删除"
                        onClick={() => setDeletingId(chapter.id)}
                        className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-slate-100 pt-3">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">导出本章</p>
            <button
              type="button"
              onClick={() => exportCurrentChapterTxt()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              导出本章内容 .txt
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">当前编辑区正文（未保存的也会导出）</span>
            </button>
            <button
              type="button"
              onClick={() => exportCurrentChapterMd()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50"
            >
              导出本章内容 .md
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">当前编辑区（纯文本格式）</span>
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void exportCurrentChapterDocx()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              导出本章内容 .docx
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">当前编辑区（文档格式）</span>
            </button>
            <p className="pt-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">导出全书</p>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void exportFullBookTxt()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              导出全书内容 .txt
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">各章为数据库已保存内容</span>
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void exportFullBookMd()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              导出全书内容 .md
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">各章为数据库已保存内容</span>
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => void exportFullBookDocx()}
              className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              导出全书内容 .docx
              <span className="mt-0.5 block text-[10px] font-normal text-slate-500">各章为数据库已保存内容</span>
            </button>
          </div>
          {/* 历史快照面板 */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setSnapshotPanelOpen((v) => !v)}
              className="flex w-full items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500 hover:text-slate-700"
            >
              <span>📸 历史快照</span>
              <span>{snapshotPanelOpen ? "▲" : "▼"}</span>
            </button>
            {snapshotPanelOpen && (
              <div className="mt-2 space-y-1">
                <button
                  type="button"
                  onClick={() => void handleManualSnapshot()}
                  className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-left text-xs text-indigo-700 hover:bg-indigo-100"
                >
                  + 手动保存快照
                </button>
                {snapshotLoading && (
                  <p className="py-2 text-center text-[10px] text-slate-400">加载中…</p>
                )}
                {!snapshotLoading && snapshots.length === 0 && (
                  <p className="py-2 text-center text-[10px] text-slate-400">暂无快照</p>
                )}
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="group rounded-lg border border-slate-100 bg-white px-2 py-1.5"
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-slate-700">
                          {snap.label ?? "快照"}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {new Date(snap.created_at).toLocaleString("zh-CN", {
                            month: "numeric", day: "numeric",
                            hour: "2-digit", minute: "2-digit"
                          })} · {snap.word_count.toLocaleString()} 字
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          disabled={snapshotRestoring === snap.id}
                          onClick={() => void handleRestoreSnapshot(snap.id)}
                          className="rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          {snapshotRestoring === snap.id ? "…" : "恢复"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteSnapshot(snap.id)}
                          className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 全书总字数 */}
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-[10px] text-slate-400">
              全书合计&nbsp;
              <span className="font-semibold tabular-nums text-slate-600">
                {chapters
                  .reduce((sum, c) => sum + (c.id === currentChapterId ? wordCount : (c.word_count ?? 0)), 0)
                  .toLocaleString()}
              </span>
              &nbsp;字 · 共 {chapters.length} 章
            </p>
          </div>
        </aside>
      )}

      {/* ── Center: editor ── */}
      <section className={`${immersive ? "col-span-1 mx-auto w-full max-w-3xl" : "col-span-6"} rounded-2xl border border-slate-200 bg-white p-6`}>
        {/* 当前章节标题 */}
        {(() => {
          const cur = chapters.find((c) => c.id === currentChapterId);
          return cur ? (
            <div className="mb-3 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
              <h2 className="min-w-0 truncate text-base font-semibold text-slate-800" title={cur.title}>
                {cur.title}
              </h2>
              <span className="shrink-0 tabular-nums text-xs text-slate-400">
                第 {cur.order_index} 章 · {wordCount.toLocaleString()} 字
              </span>
            </div>
          ) : null;
        })()}
        {narrowScreen && !mobileBannerDismissed ? (
          <div
            className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-950"
            role="region"
            aria-label="小屏写作提示"
          >
            <p className="font-medium leading-snug">建议使用电脑浏览器获得完整排版与 AI 体验；窄屏下工具栏可能拥挤。</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-md bg-amber-700 px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-amber-800"
                onClick={() => {
                  setMobileEditingEnabled(true);
                  setMobileBannerDismissed(true);
                }}
              >
                仍要在此设备编辑
              </button>
              <button
                type="button"
                className="rounded-md border border-amber-400 bg-white px-2.5 py-1.5 text-[11px] text-amber-900 hover:bg-amber-100/90"
                onClick={() => {
                  setMobileEditingEnabled(false);
                  setMobileBannerDismissed(true);
                }}
              >
                仅浏览（只读）
              </button>
            </div>
          </div>
        ) : null}
        {narrowScreen && mobileBannerDismissed && !mobileEditingEnabled ? (
          <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
            当前为只读浏览。需要编辑时请刷新页面后选择「仍要在此设备编辑」。
          </p>
        ) : null}

        {/* ── Toolbar row 1: text style ── */}
        <div
          className={`mb-2 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-2 ${
            !canEditChapter ? "pointer-events-none opacity-45" : ""
          }`}
        >
          <button type="button" title="Ctrl+Z" onClick={() => editor?.chain().focus().undo().run()} className={toolbarBtn(false)}>↩</button>
          <button type="button" title="Ctrl+Y" onClick={() => editor?.chain().focus().redo().run()} className={toolbarBtn(false)}>↪</button>
          <div className="mx-1 h-4 w-px bg-slate-200" />
          <button type="button" onClick={() => editor?.chain().focus().toggleBold().run()} className={toolbarBtn(!!editor?.isActive("bold"))}>
            <strong>B</strong>
          </button>
          <button type="button" onClick={() => editor?.chain().focus().toggleItalic().run()} className={toolbarBtn(!!editor?.isActive("italic"))}>
            <em>I</em>
          </button>
          <button type="button" onClick={() => editor?.chain().focus().toggleUnderline().run()} className={toolbarBtn(!!editor?.isActive("underline"))}>
            <span className="underline">U</span>
          </button>
          <button type="button" onClick={() => editor?.chain().focus().toggleStrike().run()} className={toolbarBtn(!!editor?.isActive("strike"))}>
            <span className="line-through">S</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!editor) return;
              const active = editor.isActive("textStyle", { color: "#dc2626" });
              editor.chain().focus().setColor(active ? "#111827" : "#dc2626").run();
            }}
            className={toolbarBtn(!!editor?.isActive("textStyle", { color: "#dc2626" }))}
          >
            <span className="text-rose-600">A</span>
          </button>
          <button type="button" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} className={toolbarBtn(false)} title="清除格式">
            ✕格式
          </button>
          <div className="mx-1 h-4 w-px bg-slate-200" />
          {(["1", "2", "3"] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => editor?.chain().focus().toggleHeading({ level: Number(level) as 1 | 2 | 3 }).run()}
              className={toolbarBtn(!!editor?.isActive("heading", { level: Number(level) }))}
            >
              H{level}
            </button>
          ))}
          <button type="button" onClick={() => editor?.chain().focus().toggleBlockquote().run()} className={toolbarBtn(!!editor?.isActive("blockquote"))}>
            引用
          </button>
          <button type="button" onClick={() => editor?.chain().focus().toggleBulletList().run()} className={toolbarBtn(!!editor?.isActive("bulletList"))}>
            • 列表
          </button>
          <button type="button" onClick={() => editor?.chain().focus().toggleOrderedList().run()} className={toolbarBtn(!!editor?.isActive("orderedList"))}>
            1. 列表
          </button>
          <button type="button" onClick={() => editor?.chain().focus().setHorizontalRule().run()} className={toolbarBtn(false)}>
            —线—
          </button>
        </div>

        {/* ── Toolbar row 2: typography + AI ── */}
        <div
          className={`mb-3 flex flex-wrap items-center gap-1 border-b border-slate-100 pb-3 ${
            !canEditChapter ? "pointer-events-none opacity-45" : ""
          }`}
        >
          {/* Font size */}
          {([14, 16, 18, 20] as const).map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => setFontSize(size)}
              className={toolbarBtn(fontSize === size)}
            >
              {size}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-slate-200" />
          {/* Font family */}
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value as FontFamily)}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:bg-slate-50"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
          {/* Line height */}
          <select
            value={lineHeight}
            onChange={(e) => setLineHeight(e.target.value as LineHeight)}
            className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:bg-slate-50"
          >
            <option value="1.6">行距 1.6</option>
            <option value="1.8">行距 1.8</option>
            <option value="2.0">行距 2.0</option>
          </select>
          {/* Indent */}
          <button
            type="button"
            onClick={() => setIndentFirst((v) => !v)}
            className={toolbarBtn(indentFirst)}
            title="首行缩进"
          >
            缩进
          </button>
          {/* Immersive */}
          <button
            type="button"
            onClick={() => setImmersive((v) => !v)}
            className={toolbarBtn(immersive)}
            title="沉浸模式"
          >
            {immersive ? "退出沉浸" : "沉浸"}
          </button>
          {immersive ? (
            <div
              ref={immersiveMenusRef}
              className="flex flex-wrap items-center gap-1 border-l border-slate-200 pl-2"
            >
              <select
                value={currentChapterId}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id && id !== currentChapterId) {
                    safeNavigate(`/editor/${bookId}/${id}`);
                  }
                }}
                className="max-w-[9rem] rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs hover:bg-slate-50 sm:max-w-[13rem]"
                title="切换章节"
                aria-label="当前章节"
              >
                {chapters
                  .slice()
                  .sort((a, b) => a.order_index - b.order_index)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setImmersiveToolbarMenu((m) => (m === "chat" ? null : "chat"))
                  }
                  className={toolbarBtn(immersiveToolbarMenu === "chat")}
                  title="续写聊天（顶栏下拉）"
                >
                  续写聊天
                </button>
                {immersiveToolbarMenu === "chat" ? (
                  <div className="absolute left-0 top-full z-[200] mt-1 w-[min(22rem,calc(100vw-2rem))] max-h-[min(70vh,32rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
                    {renderChatPanel("drawer", { onClose: () => setImmersiveToolbarMenu(null) })}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setBrainstormDialogOpen(true)}
                disabled={aiBlocked}
                className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-900 hover:bg-violet-100 disabled:opacity-60"
                title="脑洞生成：IP / 角色 / 时间线三字段弹窗"
              >
                脑洞生成
              </button>
              <Link
                href={`/dashboard/writing-tools?bookId=${encodeURIComponent(bookId)}`}
                className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title="书名、简介、大纲等写作工具台"
              >
                工具台
              </Link>
              <button
                type="button"
                onClick={() => void runParagraphVerify()}
                disabled={aiBlocked}
                className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-950 hover:bg-amber-100 disabled:opacity-60"
                title="段落查证"
              >
                {verifyRunning ? "查证中…" : "段落查证"}
              </button>
            </div>
          ) : null}
          {/* Model selector */}
          {availableModels.length > 0 && (
            <div className="flex max-w-[13rem] flex-col gap-0.5 border-r border-slate-200/80 pr-2">
              <select
                value={selectedModelKey}
                onChange={(e) => onModelChange(e.target.value)}
                className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-800"
                title={toolbarModelBillingHint.titleLine}
              >
                <option value="default">默认模型</option>
                {availableModels.map((m) => (
                  <option key={m.model_key} value={m.model_key}>
                    {m.name}
                    {m.action_type ? ` (${m.action_type})` : ""}
                    {m.word_pool === "pro" ? " · 深度创作引擎" : " · 极速创作引擎"}
                  </option>
                ))}
              </select>
              <span
                className="text-[9px] leading-tight text-violet-900/80"
                title={toolbarModelBillingHint.titleLine}
              >
                {toolbarModelBillingHint.shortLine}
              </span>
            </div>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setFindReplaceOpen((v) => !v)}
              className={toolbarBtn(findReplaceOpen)}
              title="Cmd/Ctrl + H"
            >
              查找替换
            </button>
            <button
              type="button"
              onClick={() => setDupCheckOpen((v) => !v)}
              className={toolbarBtn(dupCheckOpen)}
            >
              查重
            </button>
            <button
              type="button"
              onClick={deleteAllQuotes}
              className="rounded border border-rose-200 px-1.5 py-0.5 text-xs text-rose-700 hover:bg-rose-50"
              title="一键删除所有单引号"
            >
              删引号
            </button>
            <button
              type="button"
              onClick={onAiReviewClick}
              disabled={aiBlocked}
              className="rounded border border-slate-200 px-1.5 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-60"
            >
              审稿
            </button>
            <button
              type="button"
              onClick={() => void runParagraphVerify()}
              disabled={aiBlocked}
              className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900 hover:bg-amber-100 disabled:opacity-60"
              title="选区优先，否则当前段落；按字数计费。后台已开启联网时可辅助检索公开信息。"
            >
              {verifyRunning ? "查证中…" : "段落查证"}
            </button>
            {!immersive && (
              <>
                <button
                  type="button"
                  onClick={() => setBrainstormDialogOpen(true)}
                  disabled={aiBlocked}
                  className="rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-xs text-violet-800 hover:bg-violet-100 disabled:opacity-60"
                  title="IP / 角色 / 时间线三字段，按字数额度扣费"
                >
                  脑洞生成
                </button>
                <Link
                  href={`/dashboard/writing-tools?bookId=${encodeURIComponent(bookId)}`}
                  className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  title="写作工具台：书名、简介、大纲等"
                >
                  工具台
                </Link>
              </>
            )}
            <div
              className="flex flex-col gap-0.5"
              title={`润色：上为本章语境，下为仅选段。本章摘录上限 ${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}（按字符计）。`}
            >
              <button
                type="button"
                onClick={() => void runPolish("chapter")}
                disabled={aiBlocked}
                className="rounded bg-indigo-600 px-1.5 py-0.5 text-[11px] leading-tight text-white disabled:opacity-60"
              >
                润色（本章）
              </button>
              <button
                type="button"
                onClick={() => void runPolish("snippet")}
                disabled={aiBlocked}
                className="rounded border border-indigo-500 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
              >
                润色（仅选段）
              </button>
            </div>
            <div
              className="flex flex-col gap-0.5"
              title={`扩写：上为本章语境，下为仅选段。本章摘录上限 ${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}（按字符计）。`}
            >
              <button
                type="button"
                onClick={() => void runExpand("chapter")}
                disabled={aiBlocked}
                className="rounded bg-violet-600 px-1.5 py-0.5 text-[11px] leading-tight text-white disabled:opacity-60"
              >
                扩写（本章）
              </button>
              <button
                type="button"
                onClick={() => void runExpand("snippet")}
                disabled={aiBlocked}
                className="rounded border border-violet-500 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-violet-700 hover:bg-violet-50 disabled:opacity-60"
              >
                扩写（仅选段）
              </button>
            </div>
            <div
              className="flex flex-col gap-0.5"
              title={`去痕：上为本章语境，下为仅选段。本章摘录上限 ${AI_CHAPTER_CONTEXT_MAX_USER_LABEL}（按字符计）。`}
            >
              <button
                type="button"
                onClick={() => void runDeAi("chapter")}
                disabled={aiBlocked}
                className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] leading-tight text-white disabled:opacity-60"
              >
                去痕（本章）
              </button>
              <button
                type="button"
                onClick={() => void runDeAi("snippet")}
                disabled={aiBlocked}
                className="rounded border border-emerald-600 bg-white px-1.5 py-0.5 text-[11px] leading-tight text-emerald-800 hover:bg-emerald-50 disabled:opacity-60"
              >
                去痕（仅选段）
              </button>
            </div>
          </div>
        </div>

        {/* Status bar */}
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>
            {wordCount.toLocaleString()} 字
            {selectedCount > 0 ? ` · 已选 ${selectedCount} 字` : ""}
            {!canEditChapter ? " · 只读浏览" : blockingAi ? " · AI 处理中" : ""}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={
                !canEditChapter
                  ? "text-slate-400"
                  : saveState === "saved"
                    ? "text-emerald-600"
                    : saveState === "saving"
                      ? "text-amber-600"
                      : "text-rose-600"
              }
            >
              {!canEditChapter ? "只读" : saveState === "saved" ? "已保存" : saveState === "saving" ? "保存中…" : "保存失败"}
            </span>
            {canEditChapter && saveState === "error" ? (
              <button
                type="button"
                onClick={() => {
                  if (!editor) return;
                  const doc = editor.getJSON();
                  const wc = editor.getText().trim().length;
                  setSaveState("saving");
                  void saveChapterAction({ bookId, chapterId: currentChapterId, content: doc, wordCount: wc })
                    .then((r) => {
                      if (r.ok) {
                        lastSavedJson.current = JSON.stringify(doc);
                        setWordCount(r.wordCount ?? wc);
                        setSaveState("saved");
                      } else {
                        setSaveState("error");
                      }
                    });
                }}
                className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700 hover:bg-rose-100"
              >
                重试
              </button>
            ) : null}
          </span>
        </div>

        {aiMessage ? (
          <div className="mb-2 flex items-center gap-2">
            <p className="whitespace-pre-line text-xs text-indigo-600">{aiMessage}</p>
            {canRetryAi && lastAiAction ? (
              <button
                type="button"
                onClick={() => void retryLastGenerate()}
                disabled={aiBlocked}
                className="rounded border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-60"
              >
                重试
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Find & Replace bar */}
        {editor ? (
          <FindReplaceBar editor={editor} open={findReplaceOpen} onClose={() => setFindReplaceOpen(false)} />
        ) : null}

        {/* Tiptap editor */}
        <div className="rounded-xl border border-slate-200 p-4 ring-indigo-200 focus-within:ring">
          {editor ? (
            <>
              <EditorContent
                editor={editor}
                className="min-h-[60vh] outline-none"
                style={{
                  fontSize: `${fontSize}px`,
                  fontFamily: fontCss,
                  lineHeight,
                }}
              />
              {indentFirst && (
                <style>{`.ProseMirror p { text-indent: 2em; }`}</style>
              )}
              <BubbleMenu editor={editor}>
                <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-white p-1 shadow-md">
                  <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className="rounded px-2 py-1 text-xs font-bold hover:bg-slate-50">B</button>
                  <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className="rounded px-2 py-1 text-xs italic hover:bg-slate-50">I</button>
                  <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className="rounded px-2 py-1 text-xs underline hover:bg-slate-50">U</button>
                  <div className="h-4 w-px bg-slate-200" />
                  <div className="flex flex-col gap-px">
                    <button type="button" onClick={() => void runPolish("chapter")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">润色·本章</button>
                    <button type="button" onClick={() => void runPolish("snippet")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">润色·选段</button>
                  </div>
                  <div className="flex flex-col gap-px">
                    <button type="button" onClick={() => void runExpand("chapter")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">扩写·本章</button>
                    <button type="button" onClick={() => void runExpand("snippet")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">扩写·选段</button>
                  </div>
                  <div className="flex flex-col gap-px">
                    <button type="button" onClick={() => void runDeAi("chapter")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">去痕·本章</button>
                    <button type="button" onClick={() => void runDeAi("snippet")} disabled={aiBlocked} className="rounded px-2 py-0.5 text-[10px] leading-tight hover:bg-slate-50 disabled:opacity-60">去痕·选段</button>
                  </div>
                </div>
              </BubbleMenu>
            </>
          ) : (
            <p className="text-xs text-slate-500">编辑器加载中...</p>
          )}
        </div>
      </section>

      {/* ── Right sidebar: info + chat ── */}
      {!immersive && (
        <aside className="col-span-3 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold">写作信息</p>
          <p className="mt-2 text-xs text-slate-500">当前字数：{wordCount.toLocaleString()}</p>
          <p className="mt-1 text-xs text-slate-500">
            会话ID：{chatConversationId ? `${chatConversationId.slice(0, 10)}…` : "未建立"}
          </p>

          {/* ── 知识库面板 ── */}
          <div className="mt-3 rounded-xl border border-teal-100 bg-teal-50/40 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-teal-900">本书知识库</p>
              <button
                type="button"
                onClick={() => {
                  const next = !kbPanelOpen;
                  setKbPanelOpen(next);
                  if (next && kbItems.length === 0 && !kbLoading) void loadKbItems();
                }}
                className="text-[11px] text-teal-700 underline hover:text-teal-900"
              >
                {kbPanelOpen ? "收起" : "展开"}
              </button>
            </div>
            {kbPanelOpen ? (
              <div className="mt-2">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void loadKbItems()}
                    disabled={kbLoading}
                    className="rounded border border-teal-200 bg-white px-2 py-0.5 text-[10px] text-teal-800 hover:bg-teal-50 disabled:opacity-50"
                  >
                    {kbLoading ? "加载中…" : "刷新"}
                  </button>
                  <Link
                    href={`/dashboard/knowledge?bookId=${encodeURIComponent(bookId)}`}
                    className="text-[10px] text-teal-700 underline hover:text-teal-900"
                  >
                    管理知识库
                  </Link>
                </div>
                {kbError ? (
                  <p className="rounded bg-rose-50 px-2 py-1 text-[10px] text-rose-700">{kbError}</p>
                ) : kbItems.length === 0 && !kbLoading ? (
                  <p className="text-[10px] text-slate-500">暂无条目。可从脑洞结果「加入知识库」。</p>
                ) : (
                  <ul className="max-h-60 overflow-y-auto space-y-1.5 pr-0.5">
                    {kbItems.map((item) => (
                      <li key={item.id} className="rounded-lg border border-teal-100 bg-white p-2">
                        <p className="truncate text-[11px] font-medium text-slate-800" title={item.title}>
                          {item.title}
                        </p>
                        <p className="mt-0.5 line-clamp-2 text-[10px] text-slate-500 whitespace-pre-wrap">
                          {item.content}
                        </p>
                        <div className="mt-1.5 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              if (!editor) return;
                              insertPlainTextAsParagraphs(item.content, `「${item.title.slice(0, 12)}…」已插入正文`);
                            }}
                            disabled={!editor || !canEditChapter}
                            className="rounded bg-teal-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-teal-700 disabled:opacity-50"
                          >
                            插入正文
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(item.content);
                                toast.success("已复制");
                              } catch { toast.error("复制失败"); }
                            }}
                            className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-700 hover:bg-slate-50"
                          >
                            复制
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteKbItem(item.id)}
                            className="rounded border border-rose-200 bg-white px-2 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50"
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </div>

          {/* 脑洞生成（三字段弹窗；按字数额度池扣减） */}
          <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/40 p-3">
            <p className="text-xs font-semibold text-violet-900">脑洞生成</p>
            <p className="mt-1 text-[11px] text-violet-800/90">
              仅 IP、角色、时间线三项。生成后可「加入知识库」沉淀素材，或「插入正文」写入当前章；按所选模型池扣减额度（不扣{BILLING_WORKFLOW_CREDITS_SHORT}）。
            </p>
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
              <Link
                href={`/dashboard/writing-tools?bookId=${encodeURIComponent(bookId)}&tool=brainstorm`}
                className="text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
              >
                打开写作工具台（全部生成器）
              </Link>
              <Link
                href={`/dashboard/knowledge?bookId=${encodeURIComponent(bookId)}`}
                className="text-teal-800 underline hover:text-teal-950 dark:text-teal-300 dark:hover:text-teal-200"
              >
                本书知识库
              </Link>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-slate-500 dark:text-slate-400">
              <span className="shrink-0">快捷：</span>
              {WRITING_TOOL_QUICK_NAV_EDITOR.map(({ label, tool }, i) => (
                <span key={tool} className="inline-flex items-center gap-x-1.5">
                  {i > 0 ? <span className="text-slate-300 dark:text-slate-600">·</span> : null}
                  <Link
                    href={`/dashboard/writing-tools?bookId=${encodeURIComponent(bookId)}&tool=${tool}`}
                    className="text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900 dark:text-violet-400 dark:hover:text-violet-300"
                  >
                    {label}
                  </Link>
                </span>
              ))}
            </p>
            <button
              type="button"
              onClick={() => setBrainstormDialogOpen(true)}
              disabled={aiBlocked}
              className="mt-2 w-full rounded-md bg-violet-600 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {brainstormStatus === "running" ? "生成中…" : "打开脑洞生成"}
            </button>
            {brainstormMessage ? (
              <p className="mt-2 whitespace-pre-line text-xs text-indigo-800">{brainstormMessage}</p>
            ) : null}
            {brainstormResult ? (
              <>
                <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md border border-violet-100 bg-white p-2 text-[11px] text-slate-700 dark:border-violet-900/40 dark:bg-slate-900 dark:text-slate-200">
                  {brainstormResult}
                </pre>
                <div className="mt-2 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => void saveBrainstormToKnowledge()}
                    disabled={brainstormKbSaving || !brainstormResult.trim()}
                    className="w-full rounded-md border border-violet-300 bg-violet-50 py-1.5 text-[11px] font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/40"
                  >
                    {brainstormKbSaving ? "保存中…" : "加入知识库"}
                  </button>
                  <button
                    type="button"
                    onClick={insertBrainstormIntoEditor}
                    disabled={aiBlocked || !editor}
                    className="w-full rounded-md bg-indigo-600 py-1.5 text-[11px] font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    插入正文
                  </button>
                </div>
              </>
            ) : null}
          </div>

          {/* Duplicate check panel */}
          {editor ? (
            <DuplicateCheckPanel editor={editor} open={dupCheckOpen} onClose={() => setDupCheckOpen(false)} />
          ) : null}

          {/* Chat */}
          {renderChatPanel("sidebar")}
        </aside>
      )}
    </div>
    </>
  );
}
