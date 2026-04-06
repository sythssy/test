"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BILLING_FLASH_SHORT,
  BILLING_PRO_SHORT,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

export function BalanceDisplay({
  initialFlashWords,
  initialProWords,
  initialWorkflowCredits = 0
}: {
  initialFlashWords: number;
  initialProWords: number;
  initialWorkflowCredits?: number;
}) {
  const [flashWords, setFlashWords] = useState(initialFlashWords);
  const [proWords, setProWords] = useState(initialProWords);
  const [workflow, setWorkflow] = useState(initialWorkflowCredits);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/balance");
      if (!res.ok) return;
      const json = (await res.json()) as {
        flash_word_balance?: number;
        pro_word_balance?: number;
        workflow_credits?: number;
      };
      if (typeof json.flash_word_balance === "number") setFlashWords(json.flash_word_balance);
      if (typeof json.pro_word_balance === "number") setProWords(json.pro_word_balance);
      if (typeof json.workflow_credits === "number") setWorkflow(json.workflow_credits);
    } catch {
      // 静默失败
    }
  }, []);

  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener("ai:balance-changed", handler);
    return () => window.removeEventListener("ai:balance-changed", handler);
  }, [refresh]);

  useEffect(() => { setFlashWords(initialFlashWords); }, [initialFlashWords]);
  useEffect(() => { setProWords(initialProWords); }, [initialProWords]);
  useEffect(() => { setWorkflow(initialWorkflowCredits); }, [initialWorkflowCredits]);

  return (
    <div
      className="max-w-[14rem] rounded-xl bg-indigo-50 px-3 py-1.5 text-left text-indigo-700"
      title={`${BILLING_WORKFLOW_CREDITS_SHORT} 预留给后续整链流程，与两类字数额度分开。编辑器内 AI 按每次请求阅读+写作合并扣字数额度。`}
    >
      <div className="text-[10px] leading-tight text-indigo-600/90">{BILLING_WORKFLOW_CREDITS_SHORT}</div>
      <div className="text-xs font-semibold leading-tight">剩余 {workflow.toLocaleString()} 次</div>
      <div className="mt-1 text-[10px] leading-tight text-indigo-600/90">{BILLING_FLASH_SHORT}</div>
      <div className="text-xs font-semibold leading-tight">{flashWords.toLocaleString()} 字</div>
      <div className="mt-0.5 text-[10px] leading-tight text-indigo-600/90">{BILLING_PRO_SHORT}</div>
      <div className="text-xs font-semibold leading-tight">{proWords.toLocaleString()} 字</div>
    </div>
  );
}
