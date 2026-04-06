"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BookOpen,
  FileText,
  Globe,
  Hand,
  Hexagon,
  ImageIcon,
  List,
  ListOrdered,
  Rocket,
  Sparkles,
  User,
  UserCircle
} from "lucide-react";
import { toast } from "sonner";
import type { AiModelOption } from "@/lib/types";
import { wordPoolLabel } from "@/lib/billing-labels";
import {
  fetchBrainstormOutline,
  messageForBrainstormFailure
} from "@/lib/brainstorm-outline-client";
import { messageForKnowledgeSaveFailure, saveKnowledgeItem } from "@/lib/knowledge-items-client";
import {
  fetchWritingTool,
  messageForWritingToolFailure
} from "@/lib/writing-tool-client";
import {
  WRITING_TOOL_DEFINITIONS,
  getWritingToolDefinition,
  type WritingToolDefinition
} from "@/lib/writing-tools-config";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { sanitizeFilenameSegment } from "@/lib/chapter-content";
import { useAiConfirm, estimateAiCost, AiOpType } from "@/components/ai-cost-confirm";

type BookRow = { id: string; title: string; current_model_key: string | null };

function stripToolQueryParamFromUrl() {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  if (!u.searchParams.has("tool")) return;
  u.searchParams.delete("tool");
  const q = u.searchParams.toString();
  window.history.replaceState({}, "", q ? `${u.pathname}?${q}` : u.pathname);
}

function downloadUtf8TextFile(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type ToolCardDef = {
  id: string;
  title: string;
  subtitle: string;
  icon: ReactNode;
};

function ToolCard({
  title,
  subtitle,
  icon,
  onClick,
  highlighted,
  disabled
}: {
  title: string;
  subtitle: string;
  icon: ReactNode;
  onClick: () => void;
  highlighted?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-slate-100/90 px-4 py-6 text-center transition hover:border-slate-400 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800",
        highlighted
          ? "border-slate-500 ring-2 ring-slate-300/80 dark:border-slate-400 dark:ring-slate-600"
          : "border-slate-300 dark:border-slate-600",
        disabled ? "cursor-not-allowed opacity-50 hover:border-slate-300 dark:hover:border-slate-600" : ""
      ].join(" ")}
    >
      <span className="flex h-10 w-10 items-center justify-center text-slate-600 dark:text-slate-300">{icon}</span>
      <span className="text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
      <span className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{subtitle}</span>
    </button>
  );
}

const toolFieldClassName =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm outline-none ring-violet-100 focus:ring dark:border-slate-600 dark:bg-slate-900 dark:text-white";

export function WritingToolsClient({
  books,
  availableModels,
  initialBookId,
  initialToolId
}: {
  books: BookRow[];
  availableModels: AiModelOption[];
  initialBookId: string | null;
  /** URL ?tool= 与卡片 id 一致，含 brainstorm */
  initialToolId?: string | null;
}) {
  const bookOptions = books;
  const defaultBookId = useMemo(() => {
    if (initialBookId && bookOptions.some((b) => b.id === initialBookId)) return initialBookId;
    return bookOptions[0]?.id ?? "";
  }, [initialBookId, bookOptions]);

  const [bookId, setBookId] = useState(defaultBookId);
  const selectedBook = bookOptions.find((b) => b.id === bookId);
  const defaultModelForBook = selectedBook?.current_model_key?.trim() || "default";
  const [modelKey, setModelKey] = useState(defaultModelForBook);

  const syncModelToBook = useCallback(
    (bid: string) => {
      const b = bookOptions.find((x) => x.id === bid);
      const mk = b?.current_model_key?.trim() || "default";
      setModelKey(mk);
    },
    [bookOptions]
  );

  const [brainstormOpen, setBrainstormOpen] = useState(false);
  const [brainstormIp, setBrainstormIp] = useState("");
  const [brainstormCharacter, setBrainstormCharacter] = useState("");
  const [brainstormTimeline, setBrainstormTimeline] = useState("");
  const [brainstormRunning, setBrainstormRunning] = useState(false);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [lastGenTitle, setLastGenTitle] = useState("");
  const [lastGenMessage, setLastGenMessage] = useState("");
  const [lastGenResult, setLastGenResult] = useState("");

  const [activeWritingTool, setActiveWritingTool] = useState<WritingToolDefinition | null>(null);
  const { aiConfirmDialog, confirmAiCall } = useAiConfirm();
  const [toolFieldValues, setToolFieldValues] = useState<Record<string, string>>({});
  const [toolRunning, setToolRunning] = useState(false);

  useEffect(() => {
    const tid = (initialToolId ?? "").trim();
    if (!tid) return;
    if (typeof window === "undefined") return;
    const onceKey = `writing-tools-deeplink:${tid}:${bookId || "nobook"}`;
    if (sessionStorage.getItem(onceKey)) return;
    if (!bookId) {
      toast.info("请先选择或创建作品后再使用工具。");
      sessionStorage.setItem(onceKey, "1");
      return;
    }
    sessionStorage.setItem(onceKey, "1");
    if (tid === "brainstorm") {
      setBrainstormOpen(true);
      stripToolQueryParamFromUrl();
      return;
    }
    const def = getWritingToolDefinition(tid);
    if (def) {
      setToolFieldValues(Object.fromEntries(def.fields.map((f) => [f.key, ""])));
      setActiveWritingTool(def);
      stripToolQueryParamFromUrl();
    }
  }, [initialToolId, bookId]);

  const toolbarModelHint = useMemo(() => {
    const m = availableModels.find((x) => x.model_key === modelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const displayName = modelKey === "default" ? "默认模型" : (m?.name ?? modelKey);
    return {
      short: `扣费归属：${wordPoolLabel(pool)} · 模型「${displayName}」`,
      long: `工具台各生成器按所选模型字数池扣减；不适配时会回退 writing_tools_default / default。`
    };
  }, [availableModels, modelKey]);

  const runBrainstorm = async () => {
    const ip = brainstormIp.trim();
    const character = brainstormCharacter.trim();
    const timeline = brainstormTimeline.trim();
    if (!bookId) {
      toast.error("请先在作品库中创建作品。");
      return;
    }
    if (!ip || !character || !timeline) {
      toast.error("请填写 IP、角色、时间线（均为必填）。");
      return;
    }

    const m = availableModels.find((x) => x.model_key === modelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const userInputChars = ip.length + character.length + timeline.length;
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost("brainstorm", userInputChars);
    const confirmed = await confirmAiCall({
      operation: "脑洞生成",
      pool,
      modelName: modelKey === "default" ? "默认模型" : (m?.name ?? modelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax
    });
    if (!confirmed) return;

    setBrainstormOpen(false);
    setBrainstormRunning(true);
    setLastGenTitle("脑洞生成");
    setLastGenMessage("生成中…");
    setLastGenResult("");
    try {
      const out = await fetchBrainstormOutline({
        bookId,
        ip,
        character,
        timeline,
        model_key: modelKey
      });
      if (!out.ok) {
        setLastGenMessage(messageForBrainstormFailure(out));
        return;
      }
      setLastGenResult(out.answer);
      setLastGenMessage(out.billingDetail ? `生成完成。\n${out.billingDetail}` : "生成完成。");
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      setLastGenMessage("生成失败，请重试。");
    } finally {
      setBrainstormRunning(false);
    }
  };

  const saveBrainstormResultToKnowledge = async () => {
    const text = lastGenResult.trim();
    if (!text || lastGenTitle !== "脑洞生成" || !bookId) return;
    const title = [
      "脑洞",
      brainstormIp.trim() && `IP：${brainstormIp.trim()}`,
      brainstormCharacter.trim() && `角色：${brainstormCharacter.trim()}`,
      brainstormTimeline.trim() && `时间线：${brainstormTimeline.trim()}`
    ]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 500);
    setKnowledgeSaving(true);
    const out = await saveKnowledgeItem({
      bookId,
      content: text,
      title: title || undefined,
      type: "brainstorm",
      tags: ["脑洞"]
    });
    setKnowledgeSaving(false);
    if (!out.ok) {
      toast.error(messageForKnowledgeSaveFailure(out));
      return;
    }
    toast.success("已加入知识库");
  };

  const runWritingToolSubmit = async () => {
    if (!activeWritingTool || !bookId) return;
    for (const spec of activeWritingTool.fields) {
      if (spec.optional) continue;
      if (!(toolFieldValues[spec.key] ?? "").trim()) {
        toast.error(`请填写「${spec.label}」。`);
        return;
      }
    }

    // 估算输入字数
    const userInputChars = activeWritingTool.fields.reduce(
      (sum, spec) => sum + (toolFieldValues[spec.key] ?? "").length, 0
    );
    // 按工具 id 映射输出估算类型
    const outputKindMap: Record<string, AiOpType> = {
      title: "title", blurb: "blurb", outline: "outline", "fine-outline": "outline",
      opening: "outline", cheat: "other", names: "title", character: "other",
      world: "outline", glossary: "blurb", cover: "blurb"
    };
    const outputKind: AiOpType = outputKindMap[activeWritingTool.id] ?? "other";
    const { sysPromptMin, sysPromptMax, outputMin, outputMax } = estimateAiCost(outputKind, userInputChars);
    const m = availableModels.find((x) => x.model_key === modelKey);
    const pool = m?.word_pool === "pro" ? "pro" : "flash";
    const confirmed = await confirmAiCall({
      operation: activeWritingTool.dialogTitle,
      pool,
      modelName: modelKey === "default" ? "默认模型" : (m?.name ?? modelKey),
      userInputChars,
      sysPromptMin,
      sysPromptMax,
      outputMin,
      outputMax,
      costsWorkflowCredit: true
    });
    if (!confirmed) return;

    const def = activeWritingTool;
    setActiveWritingTool(null);
    setToolRunning(true);
    setLastGenTitle(def.dialogTitle);
    setLastGenMessage("生成中…");
    setLastGenResult("");
    try {
      const fields: Record<string, string> = {};
      for (const spec of def.fields) {
        fields[spec.key] = toolFieldValues[spec.key] ?? "";
      }
      const out = await fetchWritingTool({
        tool: def.id,
        bookId,
        model_key: modelKey,
        fields
      });
      if (!out.ok) {
        setLastGenMessage(messageForWritingToolFailure(out));
        return;
      }
      setLastGenResult(out.answer);
      setLastGenMessage(out.billingDetail ? `生成完成。\n${out.billingDetail}` : "生成完成。");
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      setLastGenMessage("生成失败，请重试。");
    } finally {
      setToolRunning(false);
    }
  };

  const toolIcons = useMemo(
    () =>
      ({
        title: <BookOpen className="h-7 w-7 stroke-[1.25]" />,
        blurb: <FileText className="h-7 w-7 stroke-[1.25]" />,
        outline: <List className="h-7 w-7 stroke-[1.25]" />,
        "fine-outline": <ListOrdered className="h-7 w-7 stroke-[1.25]" />,
        opening: <Rocket className="h-7 w-7 stroke-[1.25]" />,
        cheat: <Hand className="h-7 w-7 stroke-[1.25]" />,
        names: <User className="h-7 w-7 stroke-[1.25]" />,
        character: <UserCircle className="h-7 w-7 stroke-[1.25]" />,
        world: <Globe className="h-7 w-7 stroke-[1.25]" />,
        glossary: <Sparkles className="h-7 w-7 stroke-[1.25]" />,
        cover: <ImageIcon className="h-7 w-7 stroke-[1.25]" />
      }) as Record<string, ReactNode>,
    []
  );

  const tools: ToolCardDef[] = useMemo(() => {
    const list: ToolCardDef[] = [
      {
        id: "brainstorm",
        title: "脑洞生成器",
        subtitle: "冲破想象，打开思路",
        icon: <Hexagon className="h-7 w-7 stroke-[1.25]" />
      }
    ];
    for (const d of WRITING_TOOL_DEFINITIONS) {
      list.push({
        id: d.id,
        title: d.cardTitle,
        subtitle: d.cardSubtitle,
        icon: toolIcons[d.id] ?? <Sparkles className="h-7 w-7 stroke-[1.25]" />
      });
    }
    return list;
  }, [toolIcons]);

  return (
    <>
      {aiConfirmDialog}
      <section className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-[12rem] flex-1">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">当前作品</label>
            {bookOptions.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">
                暂无作品，请先到{" "}
                <Link href="/dashboard" className="text-indigo-600 underline">
                  作品库
                </Link>{" "}
                新建。
              </p>
            ) : (
              <select
                value={bookId}
                onChange={(e) => {
                  const v = e.target.value;
                  setBookId(v);
                  syncModelToBook(v);
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-indigo-200 focus:ring dark:border-slate-600 dark:bg-slate-800 dark:text-white"
              >
                {bookOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          {availableModels.length > 0 ? (
            <div className="min-w-[12rem] flex-1">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">计费模型</label>
              <select
                value={modelKey}
                onChange={(e) => setModelKey(e.target.value)}
                title={toolbarModelHint.long}
                className="mt-1 w-full rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2 text-sm text-violet-900 outline-none ring-violet-200 focus:ring dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100"
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
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400" title={toolbarModelHint.long}>
                {toolbarModelHint.short}
              </p>
            </div>
          ) : null}
          {bookId ? (
            <Link
              href={`/editor/${bookId}`}
              className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700/80"
            >
              进入编辑器
            </Link>
          ) : null}
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {tools.map((t) => (
          <ToolCard
            key={t.id}
            title={t.title}
            subtitle={t.subtitle}
            icon={t.icon}
            highlighted={t.id === "brainstorm"}
            disabled={brainstormRunning || toolRunning}
            onClick={() => {
              if (!bookId) {
                toast.error("请先创建并选择作品。");
                return;
              }
              if (t.id === "brainstorm") {
                setBrainstormOpen(true);
                return;
              }
              const def = WRITING_TOOL_DEFINITIONS.find((d) => d.id === t.id);
              if (!def) return;
              setToolFieldValues(Object.fromEntries(def.fields.map((f) => [f.key, ""])));
              setActiveWritingTool(def);
            }}
          />
        ))}
      </div>

      {(lastGenMessage || lastGenResult) && (
        <section className="mt-8 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-900/40 dark:bg-violet-950/20">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-violet-900 dark:text-violet-200">
              {lastGenTitle ? `${lastGenTitle} · 结果` : "生成结果"}
            </p>
            <div className="flex flex-wrap gap-2">
              {lastGenResult.trim() ? (
                <>
                  {lastGenTitle === "脑洞生成" ? (
                    <button
                      type="button"
                      onClick={() => void saveBrainstormResultToKnowledge()}
                      disabled={knowledgeSaving || !bookId}
                      className="rounded-md border border-violet-300 bg-violet-50 px-2.5 py-1 text-[11px] font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-60 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-200 dark:hover:bg-violet-900/40"
                    >
                      {knowledgeSaving ? "保存中…" : "加入知识库"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(lastGenResult);
                        toast.success("已复制到剪贴板");
                      } catch {
                        toast.error("复制失败，请手动选中复制");
                      }
                    }}
                    className="rounded-md border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-900 hover:bg-violet-50 dark:border-violet-800 dark:bg-slate-900 dark:text-violet-200 dark:hover:bg-slate-800"
                  >
                    复制正文
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const bookSeg = sanitizeFilenameSegment(selectedBook?.title ?? "作品");
                      const titleSeg = sanitizeFilenameSegment(lastGenTitle || "生成结果");
                      const day = new Date().toISOString().slice(0, 10);
                      const header = [
                        `【织梦AI】${lastGenTitle || "生成结果"}`,
                        `时间：${new Date().toLocaleString("zh-CN")}`,
                        selectedBook?.title ? `作品：${selectedBook.title}` : "",
                        ""
                      ]
                        .filter(Boolean)
                        .join("\n");
                      const body = [
                        lastGenMessage.trim() ? `${lastGenMessage.trim()}\n\n----------\n\n` : "",
                        lastGenResult.trim()
                      ].join("");
                      downloadUtf8TextFile(`${bookSeg}_${titleSeg}_${day}.txt`, `${header}\n${body}`);
                      toast.success("已下载文本文件");
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    下载 .txt
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setLastGenTitle("");
                  setLastGenMessage("");
                  setLastGenResult("");
                }}
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                清空
              </button>
            </div>
          </div>
          {lastGenMessage ? (
            <p className="mt-2 whitespace-pre-line text-xs text-indigo-900 dark:text-indigo-200">{lastGenMessage}</p>
          ) : null}
          {lastGenResult ? (
            <pre className="mt-3 max-h-[min(28rem,50vh)] overflow-y-auto whitespace-pre-wrap rounded-xl border border-violet-100 bg-white p-3 text-xs text-slate-800 dark:border-violet-900/50 dark:bg-slate-900 dark:text-slate-200">
              {lastGenResult}
            </pre>
          ) : null}
        </section>
      )}

      <Dialog open={brainstormOpen} onOpenChange={setBrainstormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>脑洞生成</DialogTitle>
            <DialogDescription>
              固定三项（IP、角色、时间线）。生成后在结果区可「加入知识库」或复制/下载；扣费按所选作品与模型。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">IP</label>
              <textarea
                value={brainstormIp}
                onChange={(e) => setBrainstormIp(e.target.value)}
                placeholder="例如：作品名 / 原作设定"
                disabled={brainstormRunning}
                rows={3}
                className={`${toolFieldClassName} min-h-[4.5rem] resize-y`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">角色</label>
              <textarea
                value={brainstormCharacter}
                onChange={(e) => setBrainstormCharacter(e.target.value)}
                placeholder="主要角色、关系或出场设定"
                disabled={brainstormRunning}
                rows={3}
                className={`${toolFieldClassName} min-h-[4.5rem] resize-y`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300">时间线</label>
              <textarea
                value={brainstormTimeline}
                onChange={(e) => setBrainstormTimeline(e.target.value)}
                placeholder="原作时间线、段落节点或 AU 前提"
                disabled={brainstormRunning}
                rows={3}
                className={`${toolFieldClassName} min-h-[4.5rem] resize-y`}
              />
            </div>
            <button
              type="button"
              onClick={() => void runBrainstorm()}
              disabled={brainstormRunning}
              className="w-full rounded-md bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {brainstormRunning ? "生成中…" : "开始生成"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!activeWritingTool}
        onOpenChange={(open) => {
          if (!open) setActiveWritingTool(null);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {activeWritingTool ? (
            <>
              <DialogHeader>
                <DialogTitle>{activeWritingTool.dialogTitle}</DialogTitle>
                <DialogDescription>{activeWritingTool.dialogDescription}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-3">
                {activeWritingTool.fields.map((spec) => (
                  <div key={spec.key}>
                    <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {spec.label}
                      {spec.optional ? (
                        <span className="font-normal text-slate-400">（可选）</span>
                      ) : null}
                    </label>
                    {spec.multiline ? (
                      <textarea
                        rows={spec.rows ?? 3}
                        value={toolFieldValues[spec.key] ?? ""}
                        onChange={(e) =>
                          setToolFieldValues((prev) => ({ ...prev, [spec.key]: e.target.value }))
                        }
                        placeholder={spec.placeholder}
                        disabled={toolRunning}
                        className={`${toolFieldClassName} min-h-[4.5rem] resize-y`}
                      />
                    ) : (
                      <input
                        value={toolFieldValues[spec.key] ?? ""}
                        onChange={(e) =>
                          setToolFieldValues((prev) => ({ ...prev, [spec.key]: e.target.value }))
                        }
                        placeholder={spec.placeholder}
                        disabled={toolRunning}
                        className={toolFieldClassName}
                      />
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => void runWritingToolSubmit()}
                  disabled={toolRunning}
                  className="w-full rounded-md bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {toolRunning ? "生成中…" : "开始生成"}
                </button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
