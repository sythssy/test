"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { BILLING_FLASH_SHORT, BILLING_PRO_SHORT } from "@/lib/billing-labels";

// ── 操作类型 ──────────────────────────────────────────────────────────────────

export type AiOpType =
  | "polish" | "expand" | "de_ai"
  | "brainstorm" | "chat" | "verify"
  | "title" | "blurb" | "outline"
  | "other";

// ── 估算参数类型 ──────────────────────────────────────────────────────────────

export interface AiConfirmOpts {
  /** 中文操作名，如"润色" */
  operation: string;
  pool: "flash" | "pro";
  modelName: string;
  /** 用户可见输入字数（不含系统提示词） */
  userInputChars: number;
  /** 系统提示词估算最小字数 */
  sysPromptMin: number;
  /** 系统提示词估算最大字数 */
  sysPromptMax: number;
  /** 预估输出最小字数 */
  outputMin: number;
  /** 预估输出最大字数 */
  outputMax: number;
  /** 是否额外消耗 1 次工作流次数 */
  costsWorkflowCredit?: boolean;
}

// ── 核心估算函数 ──────────────────────────────────────────────────────────────

/**
 * 根据操作类型和用户输入字数，返回三项估算：
 *   - 系统提示词固定开销（sysPromptMin / sysPromptMax）
 *   - 预估输出（outputMin / outputMax）
 *
 * 系统提示词范围基于常见写作功能的提示词实测长度统计（字符数），
 * 偏向保守以防低估。如后台改动提示词，实际扣减可能在此区间外，
 * 弹窗已在说明中告知用户以实际引擎返回为准。
 */
export function estimateAiCost(
  opType: AiOpType,
  userInputChars: number
): {
  sysPromptMin: number;
  sysPromptMax: number;
  outputMin: number;
  outputMax: number;
} {
  const u = Math.max(userInputChars, 10);

  // 系统提示词区间（固定，不随用户输入变化）
  const SYS: Record<AiOpType, [number, number]> = {
    polish:    [400,  800],
    de_ai:     [400,  900],
    expand:    [400,  900],
    brainstorm:[700, 1400],
    chat:      [300,  600],
    verify:    [700, 1300],
    title:     [400,  800],
    blurb:     [500, 1000],
    outline:   [700, 1600],
    other:     [500, 1100]
  };
  const [sysMin, sysMax] = SYS[opType];

  // 输出区间（随用户输入内容长度变化）
  let outputMin: number, outputMax: number;
  switch (opType) {
    case "polish":
    case "de_ai":
      outputMin = Math.round(u * 0.7);
      outputMax = Math.round(u * 1.4);
      break;
    case "expand":
      outputMin = Math.round(u * 0.9);
      outputMax = Math.round(u * 2.6);
      break;
    case "brainstorm":
      outputMin = Math.max(400, Math.round(u * 0.8));
      outputMax = Math.max(2200, Math.round(u * 2.5));
      break;
    case "chat":
      outputMin = 200;
      outputMax = Math.max(1000, Math.round(u * 0.9));
      break;
    case "verify":
      outputMin = 300;
      outputMax = 1000;
      break;
    case "title":
      outputMin = 50;
      outputMax = 350;
      break;
    case "blurb":
      outputMin = 150;
      outputMax = 700;
      break;
    case "outline":
      outputMin = Math.max(400, Math.round(u * 0.8));
      outputMax = Math.max(3500, Math.round(u * 3));
      break;
    default:
      outputMin = 200;
      outputMax = Math.max(1600, Math.round(u * 1.6));
  }

  return { sysPromptMin: sysMin, sysPromptMax: sysMax, outputMin, outputMax };
}

// ── 格式化 ────────────────────────────────────────────────────────────────────

/** 四舍五入到最近的 10 */
function r10(n: number) { return Math.round(n / 10) * 10; }

function fmtRange(min: number, max: number) {
  return `约 ${r10(min).toLocaleString()}–${r10(max).toLocaleString()} 字`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAiConfirm() {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<AiConfirmOpts | null>(null);
  const resolveRef      = useRef<((v: boolean) => void) | null>(null);

  const confirmAiCall = useCallback((options: AiConfirmOpts): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOpts(options);
      setOpen(true);
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const aiConfirmDialog = (
    <AiCostConfirmDialog
      open={open}
      opts={opts}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  return { aiConfirmDialog, confirmAiCall };
}

// ── Dialog 组件 ───────────────────────────────────────────────────────────────

function AiCostConfirmDialog({
  open, opts, onConfirm, onCancel
}: {
  open: boolean;
  opts: AiConfirmOpts | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!opts) return null;

  const engineName  = opts.pool === "pro" ? BILLING_PRO_SHORT : BILLING_FLASH_SHORT;
  const engineColor = opts.pool === "pro"
    ? "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-950/40 dark:border-violet-800"
    : "text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800";

  const totalMin = r10(opts.userInputChars + opts.sysPromptMin + opts.outputMin);
  const totalMax = r10(opts.userInputChars + opts.sysPromptMax + opts.outputMax);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-[22rem]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span>⚡</span>
            确认生成 · {opts.operation}
          </DialogTitle>
          <DialogDescription className="sr-only">
            生成前费用估算确认
          </DialogDescription>
        </DialogHeader>

        {/* 引擎 + 模型 */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${engineColor}`}>
            {engineName}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">{opts.modelName}</span>
        </div>

        {/* 费用分项明细 */}
        <div className="rounded-xl border border-slate-100 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60">
          <table className="w-full text-xs">
            <tbody>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">用户输入文本</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  约 {r10(opts.userInputChars).toLocaleString()} 字
                </td>
              </tr>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                  系统提示词
                  <span className="ml-1 text-[10px] text-slate-400">（功能固定）</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {fmtRange(opts.sysPromptMin, opts.sysPromptMax)}
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">预估输出</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500 dark:text-slate-400">
                  {fmtRange(opts.outputMin, opts.outputMax)}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 dark:border-slate-600">
                <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-100">
                  预估总扣减额度
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums text-indigo-700 dark:text-indigo-300">
                  约 {totalMin.toLocaleString()}–{totalMax.toLocaleString()} 字
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 工作流次数提示 */}
        {opts.costsWorkflowCredit && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] leading-relaxed text-indigo-700 dark:border-indigo-800/60 dark:bg-indigo-950/30 dark:text-indigo-400">
            <span className="mr-1 font-semibold">工作流次数：</span>
            本次调用将额外消耗 <span className="font-semibold">1 次</span>创作工作流次数（与字数额度独立计算）。
          </div>
        )}

        {/* Pro 附加费提示 */}
        {opts.pool === "pro" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-400">
            <span className="mr-1 font-semibold">注意：</span>
            深度引擎当日累计输出超 <span className="font-semibold">30 万字</span>后，超出部分按
            <span className="font-semibold"> 1.2 倍</span>计费。若今日已大量使用深度引擎，实际扣减可能高于上方估算。
          </div>
        )}

        {/* 说明 */}
        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
          以上为区间估算，不保证精确。实际扣减 = 引擎返回的阅读字数 + 写作字数，
          生成完成后面板将显示准确明细。点击「确认生成」即视为知悉本次预估范围并同意扣减。
        </p>

        {/* 按钮 */}
        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 active:scale-95"
          >
            确认生成 →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
