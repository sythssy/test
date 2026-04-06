"use client";

import { useState } from "react";

export function AppealForm() {
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/appeal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (json.ok) {
        setStatus("done");
        setMessage(json.message ?? "申诉已提交，请等待管理员审核。");
        setReason("");
      } else {
        setStatus("error");
        setMessage(json.message ?? "提交失败，请稍后重试。");
      }
    } catch {
      setStatus("error");
      setMessage("网络异常，请稍后重试。");
    }
  };

  if (status === "done") {
    return <p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-left">
      <label className="block text-sm font-medium text-slate-700">申诉原因</label>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={4}
        placeholder="请描述你的申诉理由，例如：我认为被误判，具体情况是……"
        className="w-full rounded-xl border border-slate-200 p-3 text-sm outline-none ring-indigo-200 focus:ring"
        required
      />
      {message ? <p className="text-xs text-rose-600">{message}</p> : null}
      <button
        type="submit"
        disabled={status === "sending" || !reason.trim()}
        className="w-full rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {status === "sending" ? "提交中..." : "提交申诉"}
      </button>
    </form>
  );
}
