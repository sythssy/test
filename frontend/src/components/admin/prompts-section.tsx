"use client";

import { useState, useTransition } from "react";
import { upsertPromptAction, deletePromptAction } from "@/app/admin/prompts/actions";

interface Prompt {
  id: string;
  action_type: string;
  name: string;
  system_prompt: string;
  dify_api_key: string;
  is_active: boolean;
}

export function AdminPromptsSection({ prompts }: { prompts: Prompt[] }) {
  const [editing, setEditing] = useState<Partial<Prompt> | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFeedback("");
    startTransition(async () => {
      const res = await upsertPromptAction(fd);
      if (res.ok) {
        setEditing(null);
        setFeedback("保存成功");
      } else {
        setFeedback(res.error ?? "保存失败");
      }
    });
  };

  const onDelete = (id: string) => {
    if (!confirm("确认删除该提示词配置？")) return;
    startTransition(async () => {
      const res = await deletePromptAction(id);
      setFeedback(res.ok ? "已删除" : (res.error ?? "删除失败"));
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold">提示词配置 (ai_prompts)</h2>
        <button
          type="button"
          onClick={() => setEditing({ is_active: true })}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white"
        >
          + 新增配置
        </button>
      </div>

      {feedback ? <p className="mb-3 text-xs text-indigo-600">{feedback}</p> : null}

      {editing !== null ? (
        <form onSubmit={onSubmit} className="mb-4 space-y-3 rounded-xl border border-slate-200 p-4">
          <p className="text-xs font-semibold text-slate-700">{editing.id ? "编辑配置" : "新增配置"}</p>
          <input type="hidden" name="id" value={editing.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <input name="action_type" required defaultValue={editing.action_type ?? ""} placeholder="action_type（唯一键，如 rewrite）" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs" />
            <input name="name" required defaultValue={editing.name ?? ""} placeholder="中文展示名（如 润色）" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs" />
          </div>
          <textarea name="system_prompt" required defaultValue={editing.system_prompt ?? ""} rows={4} placeholder="系统提示词" className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs" />
          <input name="dify_api_key" required defaultValue={editing.dify_api_key ?? ""} placeholder="引擎接口密钥（app-xxxxxxxx）" className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs font-mono" />
          <p className="text-[10px] text-slate-500">
            扣费规则：按引擎上报的阅读+写作用量合并为字数额度扣减；内部用量日志（cost_words）供后台对账；用户端只展示字数，不展示原始用量数字。
          </p>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1 text-xs">
              <input type="hidden" name="is_active" value="false" />
              <input type="checkbox" name="is_active" value="true" defaultChecked={editing.is_active !== false} className="rounded" />
              启用
            </label>
            <button type="submit" disabled={isPending} className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-60">
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs">
              取消
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="px-2 py-2">action_type</th>
              <th className="px-2 py-2">名称</th>
              <th className="px-2 py-2">系统提示词（截断）</th>
              <th className="px-2 py-2">接口密钥（截断）</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {prompts.map((p) => (
              <tr key={p.id} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2 font-mono">{p.action_type}</td>
                <td className="px-2 py-2">{p.name}</td>
                <td className="max-w-[180px] truncate px-2 py-2 text-slate-500">{p.system_prompt}</td>
                <td className="px-2 py-2 font-mono text-slate-400">{p.dify_api_key.slice(0, 10)}…</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 ${p.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {p.is_active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setEditing(p)} className="text-indigo-600 hover:underline">编辑</button>
                    <button type="button" onClick={() => onDelete(p.id)} disabled={isPending} className="text-rose-500 hover:underline disabled:opacity-60">删除</button>
                  </div>
                </td>
              </tr>
            ))}
            {!prompts.length && (
              <tr><td colSpan={6} className="px-2 py-4 text-center text-slate-400">暂无配置，点击右上角新增</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
