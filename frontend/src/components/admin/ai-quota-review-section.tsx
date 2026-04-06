"use client";

import { useState, useTransition } from "react";
import { resolveAiQuotaReviewAction } from "@/app/admin/prompts/actions";

const KIND_LABEL: Record<string, string> = {
  pro_single_output_over_50k: "深度引擎单次输出 ≥5 万字",
  pro_daily_output_over_200k: "深度引擎单日累计输出 >20 万字"
};

export type AiQuotaReviewRow = {
  id: string;
  user_id: string;
  userEmail: string;
  kind: string;
  detail: unknown;
  created_at: string;
  resolved_at: string | null;
  resolved_note: string | null;
};

export function AdminAiQuotaReviewSection({ rows }: { rows: AiQuotaReviewRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-base font-semibold">额度审核队列（深度引擎异常用量）</h2>
      <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
        由扣费 RPC 自动写入。备注仅作运营记录；若需限制账号请使用用户表{" "}
        <span className="rounded bg-slate-100 px-1 font-mono">ai_quota_blocked_until</span>{" "}
        或封禁流程。
      </p>
      {feedback ? <p className="mb-2 text-xs text-indigo-600">{feedback}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="px-2 py-2">时间</th>
              <th className="px-2 py-2">用户</th>
              <th className="px-2 py-2">类型</th>
              <th className="px-2 py-2 min-w-[12rem]">详情</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-slate-400">
                  暂无记录（或尚未执行 day27 迁移）。
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const done = Boolean(r.resolved_at);
                const detailStr =
                  r.detail != null && typeof r.detail === "object"
                    ? JSON.stringify(r.detail)
                    : String(r.detail ?? "—");
                return (
                  <tr key={r.id} className="border-b border-slate-100 align-top">
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600">
                      {new Date(r.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-slate-800">{r.userEmail}</span>
                      <span className="mt-0.5 block font-mono text-[10px] text-slate-400">{r.user_id}</span>
                    </td>
                    <td className="px-2 py-2">
                      {KIND_LABEL[r.kind] ?? r.kind}
                    </td>
                    <td className="max-w-md break-all px-2 py-2 font-mono text-[10px] text-slate-600">
                      {detailStr}
                    </td>
                    <td className="px-2 py-2">
                      {done ? (
                        <>
                          <span className="text-emerald-700">已处理</span>
                          <span className="mt-0.5 block text-[10px] text-slate-500">
                            {r.resolved_at ? new Date(r.resolved_at).toLocaleString("zh-CN") : ""}
                          </span>
                        </>
                      ) : (
                        <span className="text-amber-700">待处理</span>
                      )}
                      {r.resolved_note ? (
                        <span className="mt-1 block text-[10px] text-slate-500">备注：{r.resolved_note}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {!done ? (
                        <div className="flex max-w-[14rem] flex-col gap-1">
                          <input
                            type="text"
                            placeholder="处理备注（可选）"
                            value={notes[r.id] ?? ""}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            className="rounded border border-slate-200 px-2 py-1 text-[11px] outline-none"
                          />
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              startTransition(async () => {
                                const res = await resolveAiQuotaReviewAction(r.id, notes[r.id] ?? "");
                                setFeedback(res.ok ? "已标记为已处理" : (res.error ?? "失败"));
                              })
                            }
                            className="rounded bg-indigo-600 px-2 py-1 text-[11px] text-white hover:bg-indigo-700 disabled:opacity-60"
                          >
                            标记已处理
                          </button>
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
