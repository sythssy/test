"use client";

import { useState, useTransition } from "react";
import { handleAppealAction } from "@/app/admin/prompts/actions";

interface AppealRow {
  id: string;
  user_id: string;
  userEmail: string;
  reason: string;
  status: string;
  admin_note: string | null;
  created_at: string;
}

export function AdminAppealsSection({ appeals }: { appeals: AppealRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const handle = (appealId: string, decision: "approved" | "rejected") => {
    if (!confirm(decision === "approved" ? "确认批准解封？" : "确认驳回申诉？")) return;
    startTransition(async () => {
      const res = await handleAppealAction(appealId, decision, notes[appealId] ?? "");
      setFeedback(res.ok ? "操作成功" : (res.error ?? "操作失败"));
    });
  };

  const pending = appeals.filter((a) => a.status === "pending");
  const resolved = appeals.filter((a) => a.status !== "pending");

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-3 text-base font-semibold">申诉管理</h2>
      {feedback ? <p className="mb-3 text-xs text-indigo-600">{feedback}</p> : null}

      {pending.length === 0 ? (
        <p className="text-xs text-slate-400">暂无待处理申诉。</p>
      ) : (
        <div className="space-y-3">
          {pending.map((a) => (
            <div key={a.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold">{a.userEmail}</p>
                  <p className="mt-1 text-xs text-slate-600">{a.reason}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{new Date(a.created_at).toLocaleString("zh-CN")}</p>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  <input
                    placeholder="管理员备注（选填）"
                    value={notes[a.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handle(a.id, "approved")}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-white disabled:opacity-60"
                    >
                      批准解封
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handle(a.id, "rejected")}
                      className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
                    >
                      驳回
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-slate-400">已处理申诉（{resolved.length} 条）</summary>
          <div className="mt-2 space-y-1">
            {resolved.map((a) => (
              <p key={a.id} className="text-xs text-slate-500">
                [{a.status === "approved" ? "已批准" : "已驳回"}] {a.userEmail}：{a.reason}
                {a.admin_note ? `（备注：${a.admin_note}）` : ""}
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
