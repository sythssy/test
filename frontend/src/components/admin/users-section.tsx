"use client";

import { useTransition, useState } from "react";
import { banUserAction, unbanUserAction } from "@/app/admin/prompts/actions";
import {
  BILLING_FLASH_BASE_WORDS_LABEL,
  BILLING_PRO_ADV_WORDS_LABEL,
  BILLING_WORKFLOW_CREDITS_SHORT
} from "@/lib/billing-labels";

interface UserRow {
  id: string;
  email: string;
  role: string;
  status: string;
  flash_word_balance: number;
  pro_word_balance: number;
  workflow_credits: number;
  usage: { usedWords: number; requests: number; chatWords: number; generateWords: number; usedTokens: number };
  welfare: { welfareCount: number; welfareFlashIn: number; welfareProIn: number };
  riskCount: number;
}

export function AdminUsersSection({
  users,
  welfareStatsNote
}: {
  users: UserRow[];
  welfareStatsNote: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");

  const toggleBan = (userId: string, isBanned: boolean) => {
    if (!confirm(isBanned ? "确认解封该用户？" : "确认封禁该用户？")) return;
    startTransition(async () => {
      const res = isBanned ? await unbanUserAction(userId) : await banUserAction(userId);
      setFeedback(res.ok ? (isBanned ? "已解封" : "已封禁") : (res.error ?? "操作失败"));
    });
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-3 text-base font-semibold">用户管理与使用统计</h2>
      <p className="mb-3 text-[11px] text-slate-500">{welfareStatsNote}</p>
      {feedback ? <p className="mb-3 text-xs text-indigo-600">{feedback}</p> : null}
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="px-2 py-2">用户邮箱</th>
              <th className="px-2 py-2">角色</th>
              <th className="px-2 py-2">状态</th>
              <th className="px-2 py-2">{BILLING_FLASH_BASE_WORDS_LABEL}</th>
              <th className="px-2 py-2">{BILLING_PRO_ADV_WORDS_LABEL}</th>
              <th
                className="px-2 py-2"
                title="预留给整链；单次 AI 按字数额度扣减，不占此项。"
              >
                {BILLING_WORKFLOW_CREDITS_SHORT}
              </th>
              <th className="px-2 py-2">累计用字</th>
              <th className="px-2 py-2">累计用量</th>
              <th className="px-2 py-2">请求次数</th>
              <th className="px-2 py-2 whitespace-nowrap" title="action_type = welfare_credit 的账单条数">
                福利笔数
              </th>
              <th
                className="px-2 py-2 min-w-[7rem]"
                title="福利入账合计（仅统计福利流水中的 flash_credit / pro_credit）"
              >
                <span className="block">累计入账</span>
                <span className="block text-[10px] font-normal text-slate-400">
                  {BILLING_FLASH_BASE_WORDS_LABEL} / {BILLING_PRO_ADV_WORDS_LABEL}
                </span>
              </th>
              <th className="px-2 py-2">风险次数</th>
              <th className="px-2 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-b border-slate-100 last:border-0 ${u.status === "banned" ? "bg-rose-50" : ""}`}>
                <td className="px-2 py-2">{u.email}</td>
                <td className="px-2 py-2">{u.role}</td>
                <td className="px-2 py-2">
                  <span className={`rounded-full px-2 py-0.5 ${u.status === "banned" ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                    {u.status === "banned" ? "已封禁" : "正常"}
                  </span>
                </td>
                <td className="px-2 py-2">{u.flash_word_balance}</td>
                <td className="px-2 py-2">{u.pro_word_balance}</td>
                <td className="px-2 py-2">{u.workflow_credits ?? 0}</td>
                <td className="px-2 py-2">{u.usage.usedWords}</td>
                <td className="px-2 py-2">{u.usage.usedTokens}</td>
                <td className="px-2 py-2">{u.usage.requests}</td>
                <td className="px-2 py-2 tabular-nums text-slate-700">{u.welfare.welfareCount}</td>
                <td className="px-2 py-2 text-[11px] leading-snug tabular-nums">
                  <span className="text-amber-800 dark:text-amber-200">
                    +{u.welfare.welfareFlashIn.toLocaleString()}
                  </span>
                  <span className="mx-0.5 text-slate-300">·</span>
                  <span className="text-violet-800 dark:text-violet-200">
                    +{u.welfare.welfareProIn.toLocaleString()}
                  </span>
                </td>
                <td className="px-2 py-2">
                  <span className={u.riskCount > 0 ? "text-rose-600 font-semibold" : "text-slate-400"}>
                    {u.riskCount}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {u.role !== "admin" ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => toggleBan(u.id, u.status === "banned")}
                      className={`rounded px-2 py-0.5 text-xs disabled:opacity-60 ${u.status === "banned" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-rose-50 text-rose-700 hover:bg-rose-100"}`}
                    >
                      {u.status === "banned" ? "解封" : "封禁"}
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
