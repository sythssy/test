"use client";

import { useState, useTransition } from "react";
import { generateRedeemCodeBatchAction } from "@/app/admin/redeem/actions";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

const WORD_PRESETS = [
  { label: "不含字数", value: 0 },
  { label: "10 万字", value: 100_000 },
  { label: "50 万字", value: 500_000 },
  { label: "100 万字", value: 1_000_000 },
  { label: "300 万字", value: 3_000_000 }
];

const WF_PRESETS = [
  { label: "不含次数", value: 0 },
  { label: "1 次", value: 1 },
  { label: "5 次", value: 5 },
  { label: "10 次", value: 10 },
  { label: "20 次", value: 20 }
];

export interface RedeemCodeRow {
  id: string;
  code: string;
  flash_word_count: number;
  pro_word_count: number;
  workflow_count: number;
  is_used: boolean;
  used_user_id: string | null;
  used_at: string | null;
  created_at: string;
}

export function AdminRedeemCodesSection({ rows }: { rows: RedeemCodeRow[] }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [lastGenerated, setLastGenerated] = useState<string[]>([]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setFeedback("");
    setLastGenerated([]);
    startTransition(async () => {
      const res = await generateRedeemCodeBatchAction(fd);
      if (res.ok) {
        setLastGenerated(res.codes);
        setFeedback(`已生成 ${res.codes.length} 条激活码，可复制下方列表`);
      } else {
        setFeedback(res.error ?? "生成失败");
      }
    });
  };

  const copyText = (text: string) => {
    void navigator.clipboard.writeText(text);
    setFeedback("已复制到剪贴板");
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-base font-semibold">激活码管理</h2>
      <p className="mb-4 text-xs text-slate-500">
        每条码一码一用，绑定账号后立即作废，无法重复兑换。至少含以下一项：
        {BILLING_FLASH_BASE_WORDS_LABEL}、{BILLING_PRO_ADV_WORDS_LABEL}、{BILLING_WORKFLOW_CREDITS_SHORT}。
      </p>

      <form
        onSubmit={onSubmit}
        className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-4"
      >
        <div>
          <label className="mb-1 block text-xs text-slate-600">{BILLING_FLASH_BASE_WORDS_LABEL}</label>
          <select
            name="flash_word_count"
            className="max-w-[12rem] rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
            defaultValue={100_000}
          >
            {WORD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
                {p.value > 0 ? `（${p.value.toLocaleString()}）` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">{BILLING_PRO_ADV_WORDS_LABEL}</label>
          <select
            name="pro_word_count"
            className="max-w-[12rem] rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
            defaultValue={0}
          >
            {WORD_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
                {p.value > 0 ? `（${p.value.toLocaleString()}）` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">{BILLING_WORKFLOW_CREDITS_SHORT}</label>
          <p className="mb-1 text-[10px] leading-snug text-slate-500">
            整链上线后扣次；当前 AI 操作走字数额度，不占此项。
          </p>
          <select
            name="workflow_count"
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
            defaultValue={0}
          >
            {WF_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-slate-600">生成条数</label>
          <input
            name="count"
            type="number"
            min={1}
            max={200}
            defaultValue={5}
            className="w-24 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs"
            required
          />
        </div>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-indigo-600 px-4 py-2 text-xs text-white disabled:opacity-60"
        >
          {isPending ? "生成中…" : "批量生成"}
        </button>
      </form>

      {feedback ? (
        <p className="mb-3 text-xs text-indigo-600">{feedback}</p>
      ) : null}

      {lastGenerated.length > 0 ? (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <p className="mb-2 text-xs font-medium text-emerald-800">
            本次生成 {lastGenerated.length} 条（点按钮一键复制）
          </p>
          <button
            type="button"
            onClick={() => copyText(lastGenerated.join("\n"))}
            className="mb-2 rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] text-emerald-800"
          >
            复制全部
          </button>
          <pre className="max-h-32 overflow-auto text-[11px] leading-relaxed text-slate-700">
            {lastGenerated.join("\n")}
          </pre>
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="px-2 py-2">激活码</th>
              <th className="px-2 py-2">极速引擎字数</th>
              <th className="px-2 py-2">深度引擎字数</th>
              <th className="px-2 py-2">工作流次</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">使用时间</th>
              <th className="px-2 py-2">生成时间</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-slate-100 last:border-0">
                <td className="px-2 py-2 font-mono">
                  <button
                    type="button"
                    onClick={() => copyText(r.code)}
                    className="text-left hover:text-indigo-600"
                    title="点击复制"
                  >
                    {r.code}
                  </button>
                </td>
                <td className="px-2 py-2">{r.flash_word_count.toLocaleString()}</td>
                <td className="px-2 py-2">{r.pro_word_count.toLocaleString()}</td>
                <td className="px-2 py-2">{r.workflow_count}</td>
                <td className="px-2 py-2">
                  <span className={r.is_used ? "text-slate-400" : "text-emerald-600 font-medium"}>
                    {r.is_used ? "已使用" : "未使用"}
                  </span>
                </td>
                <td className="px-2 py-2 text-slate-500">
                  {r.used_at ? new Date(r.used_at).toLocaleString() : "—"}
                </td>
                <td className="px-2 py-2 text-slate-500">
                  {new Date(r.created_at).toLocaleString()}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-slate-400">
                  暂无激活码，请先批量生成
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
