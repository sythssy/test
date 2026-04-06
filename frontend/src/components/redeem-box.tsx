"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

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
      `left:${x}px`, `top:${y}px`,
      `width:${size}px`, `height:${size}px`,
      "border-radius:9999px",
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

/**
 * 内嵌激活码兑换框，不弹 Dialog。
 * shopUrl = 第三方平台链接（环境变量 NEXT_PUBLIC_SHOP_URL）。
 */
export function RedeemBox({ shopUrl }: { shopUrl?: string }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const onRedeem = useCallback(async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { toast.error("请填写激活码"); return; }
    setLoading(true);
    setSuccessMsg("");
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
        toast.error(json.message || "激活码无效或已使用");
        return;
      }
      const af = json.added_flash_words ?? 0;
      const ap = json.added_pro_words ?? 0;
      const ar = json.added_workflow ?? 0;
      const parts: string[] = [];
      if (af > 0) parts.push(`+${af.toLocaleString()} ${BILLING_FLASH_BASE_WORDS_LABEL}`);
      if (ap > 0) parts.push(`+${ap.toLocaleString()} ${BILLING_PRO_ADV_WORDS_LABEL}`);
      if (ar > 0) parts.push(`+${ar.toLocaleString()} 次 ${BILLING_WORKFLOW_CREDITS_SHORT}`);
      const msg = parts.length ? `兑换成功！${parts.join("，")}` : "兑换成功！";
      setSuccessMsg(msg);
      setCode("");
      fireMiniConfetti(btnRef.current);
      window.dispatchEvent(new Event("ai:balance-changed"));
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  }, [code]);

  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
        激活码兑换
      </label>
      <div className="flex gap-2">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="粘贴或输入激活码"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          autoComplete="off"
          disabled={loading}
          onKeyDown={(e) => { if (e.key === "Enter") void onRedeem(); }}
        />
        <button
          ref={btnRef}
          type="button"
          onClick={() => void onRedeem()}
          disabled={loading}
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? "处理中…" : "立即兑换"}
        </button>
      </div>
      {successMsg ? (
        <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          {successMsg}
        </p>
      ) : null}
      {shopUrl ? (
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          还没有激活码？
          <a
            href={shopUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 font-medium text-indigo-600 underline hover:text-indigo-800 dark:text-indigo-400"
          >
            点击获取激活码 →
          </a>
        </p>
      ) : null}
    </div>
  );
}
