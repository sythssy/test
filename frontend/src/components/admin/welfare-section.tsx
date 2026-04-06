"use client";

import { useState, useTransition } from "react";
import { grantWordWelfareAction } from "@/app/admin/grant-welfare-action";

export function AdminWelfareSection({
  models
}: {
  models: { model_key: string; name: string; word_pool: "flash" | "pro" }[];
}) {
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-base font-semibold">批量福利（字数包）</h2>
      <p className="mb-4 text-xs text-slate-500">
        填写用户 ID（UUID），每行一个或逗号/分号分隔。下方按<strong>各个模型</strong>填写赠送字数，系统会按该模型所属引擎分别汇总后，一次性记入每位用户余额，并写入「福利入账」。
      </p>

      {msg ? (
        <p className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{msg}</p>
      ) : null}
      {err ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">{err}</p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg("");
          setErr("");
          const fd = new FormData(e.currentTarget);
          startTransition(() => {
            void grantWordWelfareAction(fd).then((r) => {
              if (r.ok) {
                setMsg(
                  `已发放 ${r.applied} 位用户（极速引擎 +${r.flash.toLocaleString()} · 深度引擎 +${r.pro.toLocaleString()}）。未匹配 UUID：${r.skipped}。`
                );
              } else {
                setErr(r.error);
              }
            });
          });
        }}
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">目标用户 ID</label>
          <textarea
            name="user_ids"
            required
            rows={5}
            placeholder={"550e8400-e29b-41d4-a716-446655440000\n550e8400-e29b-41d4-a716-446655440001"}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none ring-indigo-200 focus:ring"
          />
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-100">
          <table className="min-w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50 text-slate-500">
              <tr>
                <th className="px-2 py-2">模型</th>
                <th className="px-2 py-2">归属池</th>
                <th className="px-2 py-2">赠送字数</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.model_key} className="border-b border-slate-50 last:border-0">
                  <td className="px-2 py-2">
                    <span className="font-medium text-slate-800">{m.name}</span>
                    <span className="ml-2 font-mono text-slate-400">{m.model_key}</span>
                  </td>
                  <td className="px-2 py-2">
                    <span className={m.word_pool === "pro" ? "text-violet-600" : "text-amber-700"}>
                      {m.word_pool === "pro" ? "深度引擎" : "极速引擎"}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <input
                      type="number"
                      name={`grant_${m.model_key}`}
                      min={0}
                      step={1}
                      defaultValue={0}
                      className="w-28 rounded border border-slate-200 px-2 py-1 tabular-nums outline-none focus:border-indigo-400"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {pending ? "处理中…" : "确认发放"}
        </button>
      </form>
    </section>
  );
}
