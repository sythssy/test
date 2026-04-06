"use client";

import { useCallback, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

const DEFAULT_HINT =
  "获取激活码以补充字数额度，请联系管理员，或按管理员说明的渠道领取。";

function fireMiniConfetti(originEl: HTMLElement | null) {
  if (typeof window === "undefined") return;
  const rect = originEl?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 3;

  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.className = "pointer-events-none fixed inset-0 z-[100]";
  document.body.appendChild(layer);

  const colors = ["#6366f1", "#a855f7", "#ec4899", "#22c55e", "#f59e0b", "#38bdf8"];
  const n = 48;
  for (let i = 0; i < n; i++) {
    const dot = document.createElement("span");
    const size = 4 + Math.random() * 4;
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const speed = 120 + Math.random() * 180;
    dot.style.cssText = [
      "position:absolute",
      `left:${x}px`,
      `top:${y}px`,
      `width:${size}px`,
      `height:${size}px`,
      `border-radius:9999px`,
      `background:${colors[i % colors.length]}`,
      "opacity:0.95",
      "transform:translate(-50%,-50%)",
      `transition:transform ${0.9 + Math.random() * 0.3}s ease-out,opacity 0.9s ease-out`
    ].join(";");
    layer.appendChild(dot);
    requestAnimationFrame(() => {
      dot.style.transform = `translate(calc(-50% + ${Math.cos(angle) * speed}px), calc(-50% + ${Math.sin(angle) * speed + 40}px))`;
      dot.style.opacity = "0";
    });
  }
  window.setTimeout(() => layer.remove(), 1200);
}

export function RedeemDialog({
  open,
  onOpenChange,
  balanceFlashWords,
  balanceProWords,
  balanceWorkflow
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  balanceFlashWords: number;
  balanceProWords: number;
  balanceWorkflow: number;
}) {
  const successBtnRef = useRef<HTMLButtonElement>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  const hint =
    typeof process.env.NEXT_PUBLIC_CDK_CONTACT_HINT === "string" &&
    process.env.NEXT_PUBLIC_CDK_CONTACT_HINT.trim()
      ? process.env.NEXT_PUBLIC_CDK_CONTACT_HINT.trim()
      : DEFAULT_HINT;

  const onRedeem = useCallback(async () => {
    const trimmed = code.trim();
    if (!trimmed) {
      toast.error("请填写激活码");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed })
      });
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        added_flash_words?: number;
        added_pro_words?: number;
        added_workflow?: number;
      };
      if (!res.ok || !json.ok) {
        toast.error(json.message || "兑换码无效或已使用");
        return;
      }
      const af = json.added_flash_words ?? 0;
      const ap = json.added_pro_words ?? 0;
      const ar = json.added_workflow ?? 0;
      const parts: string[] = [];
      if (af > 0) parts.push(`+${af.toLocaleString()} (${BILLING_FLASH_BASE_WORDS_LABEL})`);
      if (ap > 0) parts.push(`+${ap.toLocaleString()} (${BILLING_PRO_ADV_WORDS_LABEL})`);
      if (ar > 0) parts.push(`+${ar.toLocaleString()} 次（${BILLING_WORKFLOW_CREDITS_SHORT}）`);
      toast.success(parts.length ? `核销成功！${parts.join("，")}` : "核销成功！");
      setCode("");
      fireMiniConfetti(successBtnRef.current);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }, [code]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="mb-1 text-center text-xs font-medium uppercase tracking-wide text-indigo-500">
          通行证资产 · 核销
        </div>
        <DialogTitle className="mb-4 text-center text-lg font-semibold text-slate-900">
          当前余额
        </DialogTitle>
        <DialogDescription className="sr-only">
          查看余额并兑换激活码
        </DialogDescription>

        <div className="mb-4 space-y-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm">
          <p className="flex justify-between gap-2">
            <span className="text-slate-600">{BILLING_WORKFLOW_CREDITS_SHORT} 剩余</span>
            <span className="shrink-0 font-semibold text-indigo-700">{balanceWorkflow.toLocaleString()} 次</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-slate-600">{BILLING_FLASH_BASE_WORDS_LABEL} 剩余</span>
            <span className="shrink-0 font-semibold text-indigo-700">{balanceFlashWords.toLocaleString()} 字</span>
          </p>
          <p className="flex justify-between gap-2">
            <span className="text-slate-600">{BILLING_PRO_ADV_WORDS_LABEL} 剩余</span>
            <span className="shrink-0 font-semibold text-indigo-700">{balanceProWords.toLocaleString()} 字</span>
          </p>
        </div>

        <p className="mb-4 text-[11px] leading-relaxed text-slate-500">
          {BILLING_WORKFLOW_CREDITS_SHORT}预留给后续整链能力。润色、扩写、去痕、侧栏聊天与「脑洞大纲」均按每次请求的阅读+写作用量从下方两类字数额度池合并扣减，不使用上述次数。
        </p>

        <label className="mb-1 block text-xs font-medium text-slate-600">输入激活码</label>
        <div className="flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="粘贴激活码"
            className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            autoComplete="off"
            disabled={loading}
            onKeyDown={(e) => {
              if (e.key === "Enter") void onRedeem();
            }}
          />
          <button
            ref={successBtnRef}
            type="button"
            onClick={() => void onRedeem()}
            disabled={loading}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "处理中…" : "充值核销"}
          </button>
        </div>

        <p className="mt-4 border-t border-slate-100 pt-4 text-center text-[11px] leading-relaxed text-slate-500">
          {hint}
        </p>

        <button
          type="button"
          className="mt-4 w-full rounded-lg border border-slate-200 py-2 text-xs text-slate-600 hover:bg-slate-50"
          onClick={() => onOpenChange(false)}
        >
          关闭
        </button>
      </DialogContent>
    </Dialog>
  );
}
