"use client";

import { useState, useTransition } from "react";
import { upsertModelAction, deleteModelAction } from "@/app/admin/models/actions";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

interface AiModel {
  id: string;
  model_key: string;
  name: string;
  action_type: string | null;
  dify_api_key: string;
  is_active: boolean;
  sort_order: number;
  /** 未跑 day16 迁移前可能缺省，按 flash 显示 */
  word_pool?: "flash" | "pro" | null;
  created_at: string;
}

export function AdminModelsSection({ models }: { models: AiModel[] }) {
  const [editing, setEditing] = useState<Partial<AiModel> | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [isPending, startTransition] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFeedback("");
    startTransition(async () => {
      const res = await upsertModelAction(fd);
      if (res.ok) { setEditing(null); setFeedback("保存成功"); }
      else setFeedback(res.error ?? "保存失败");
    });
  };

  const onDelete = (id: string) => {
    setConfirmDeleteId(null);
    startTransition(async () => {
      const res = await deleteModelAction(id);
      setFeedback(res.ok ? "已删除" : (res.error ?? "删除失败"));
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800">模型管理 (ai_models)</h2>
        <button
          type="button"
          onClick={() => setEditing({ is_active: true, sort_order: 0, word_pool: "flash" })}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
        >
          + 新增模型
        </button>
      </div>

      {feedback ? (
        <p className="mb-3 text-sm text-indigo-600">{feedback}</p>
      ) : null}

      {/* Edit form */}
      {editing !== null && (
        <form onSubmit={onSubmit} className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50 p-4">
          <input type="hidden" name="id" value={editing.id ?? ""} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">model_key（唯一键）</label>
              <input
                name="model_key"
                required
                defaultValue={editing.model_key ?? ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring focus:ring-indigo-200"
                placeholder="例如: polish_fast"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">字数扣费池（极速 / 深度引擎）</label>
              <select
                name="word_pool"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:ring focus:ring-indigo-200"
                defaultValue={editing.word_pool ?? "flash"}
              >
                <option value="flash">{BILLING_FLASH_BASE_WORDS_LABEL}</option>
                <option value="pro">{BILLING_PRO_ADV_WORDS_LABEL}</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">展示名称</label>
              <input
                name="name"
                required
                defaultValue={editing.name ?? ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring focus:ring-indigo-200"
                placeholder="例如: 润色快速版"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">适用动作（可空=通用）</label>
              <input
                name="action_type"
                defaultValue={editing.action_type ?? ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring focus:ring-indigo-200"
                placeholder="polish / chat / brainstorm_outline / book_title / …（与 ai_prompts 一致）"
              />
              <p className="mt-1 text-[10px] text-slate-500">
                与 ai_prompts、账单 action_type 对齐；扣费从本模型所选字数池按次合并扣减，不占用户{BILLING_WORKFLOW_CREDITS_SHORT}。
              </p>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">创作引擎接口密钥</label>
              <input
                name="dify_api_key"
                defaultValue={editing.dify_api_key ?? ""}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono outline-none focus:ring focus:ring-indigo-200"
                placeholder="app-xxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">排序（越小越靠前）</label>
              <input
                name="sort_order"
                type="number"
                defaultValue={editing.sort_order ?? 0}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:ring focus:ring-indigo-200"
              />
            </div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="hidden"
                  name="is_active"
                  value={editing.is_active ? "true" : "false"}
                />
                <input
                  type="checkbox"
                  checked={editing.is_active ?? true}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  className="h-4 w-4 rounded"
                />
                <span className="text-slate-600">启用</span>
              </label>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={isPending} className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm text-white disabled:opacity-60">
              {isPending ? "保存中…" : "保存"}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-slate-300 px-4 py-1.5 text-sm hover:bg-slate-50">
              取消
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
              <th className="pb-2 pr-4">model_key</th>
              <th className="pb-2 pr-4">名称</th>
              <th className="pb-2 pr-4">适用动作</th>
              <th className="pb-2 pr-4">扣费池</th>
              <th className="pb-2 pr-4">状态</th>
              <th className="pb-2 pr-4">排序</th>
              <th className="pb-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id} className="border-b border-slate-50">
                <td className="py-2 pr-4 font-mono text-xs">{model.model_key}</td>
                <td className="py-2 pr-4">{model.name}</td>
                <td className="py-2 pr-4 text-xs text-slate-500">{model.action_type ?? "通用"}</td>
                <td className="py-2 pr-4 text-xs text-slate-600">
                  {(model.word_pool ?? "flash") === "pro"
                    ? BILLING_PRO_ADV_WORDS_LABEL
                    : BILLING_FLASH_BASE_WORDS_LABEL}
                </td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs ${model.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    {model.is_active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="py-2 pr-4 text-xs text-slate-500">{model.sort_order}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => { setEditing(model); setFeedback(""); }}
                      className="text-xs text-indigo-600 hover:underline"
                    >
                      编辑
                    </button>
                    {confirmDeleteId === model.id ? (
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-rose-600">确认删除「{model.name}」？</span>
                        <button type="button" onClick={() => onDelete(model.id)} disabled={isPending} className="rounded bg-rose-600 px-1.5 py-0.5 text-xs text-white">确认</button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className="rounded border border-slate-200 px-1.5 py-0.5 text-xs">取消</button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(model.id)}
                        className="text-xs text-rose-600 hover:underline"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!models.length && (
          <p className="py-4 text-center text-sm text-slate-400">暂无模型配置，点击上方 + 新增模型 添加。</p>
        )}
      </div>
    </section>
  );
}
