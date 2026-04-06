export interface AdminBillingLogRow {
  id: string;
  user_id: string;
  userEmail: string;
  action_type: string;
  model_key: string | null;
  cost_words: number;
  flash_credit: number;
  pro_credit: number;
  input_words: number;
  output_words: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  created_at: string;
}

/** 管理员查看最近流水：字数扣减 + token 明细（与前台「阅读/写作」同源） */
export function AdminBillingLogsSection({
  logs,
  displayLimit = 150
}: {
  logs: AdminBillingLogRow[];
  displayLimit?: number;
}) {
  const shown = logs.slice(0, displayLimit);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="mb-1 text-base font-semibold">最近用量流水</h2>
      <p className="mb-3 text-xs text-slate-500">
        按时间倒序，最多展示 {displayLimit} 条。扣减额度 = 阅读+写作用量合并（内部记入 cost_words）；阅读/写作列为引擎上报明细。
      </p>
      {shown.length === 0 ? (
        <p className="text-xs text-slate-400">暂无账单记录。</p>
      ) : (
        <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-100">
          <table className="min-w-full text-left text-xs">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-slate-500">
              <tr>
                <th className="whitespace-nowrap px-2 py-2">时间</th>
                <th className="px-2 py-2">用户</th>
                <th className="px-2 py-2">操作类型</th>
                <th className="px-2 py-2">引擎</th>
                <th className="whitespace-nowrap px-2 py-2">扣减额度</th>
                <th className="whitespace-nowrap px-2 py-2">极速入账</th>
                <th className="whitespace-nowrap px-2 py-2">深度入账</th>
                <th className="whitespace-nowrap px-2 py-2">阅读用量</th>
                <th className="whitespace-nowrap px-2 py-2">写作用量</th>
                <th className="whitespace-nowrap px-2 py-2">总用量</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 last:border-0">
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="max-w-[10rem] truncate px-2 py-1.5" title={r.userEmail}>
                    {r.userEmail}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-slate-700">{r.action_type}</td>
                  <td className="max-w-[8rem] truncate px-2 py-1.5 font-mono text-slate-500">
                    {r.model_key ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{Number(r.cost_words).toLocaleString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-emerald-700">
                    {r.flash_credit > 0 ? `+${r.flash_credit.toLocaleString()}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-emerald-700">
                    {r.pro_credit > 0 ? `+${r.pro_credit.toLocaleString()}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">
                    {Number(r.input_tokens).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">
                    {Number(r.output_tokens).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 tabular-nums font-medium text-slate-800">
                    {Number(r.total_tokens).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
