import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";
import { AdminPromptsSection } from "@/components/admin/prompts-section";
import { AdminUsersSection } from "@/components/admin/users-section";
import { AdminAppealsSection } from "@/components/admin/appeals-section";
import { AdminCdkSection } from "@/components/admin/cdk-section";
import { AdminRedeemCodesSection } from "@/components/admin/redeem-codes-section";
import { AdminModelsSection } from "@/components/admin/models-section";
import { AdminBillingLogsSection } from "@/components/admin/billing-logs-section";
import { AdminWelfareSection } from "@/components/admin/welfare-section";
import { AdminAiQuotaReviewSection } from "@/components/admin/ai-quota-review-section";
import { AI_ACTION_CHAT, AI_ACTION_WELFARE_CREDIT } from "@/lib/ai-action-types";

export const metadata: Metadata = {
  title: "管理后台",
  description: "用户、提示词、模型、CDK、账单与风控等运维入口。"
};

export default async function AdminPage() {
  const profile = await requireAuth();
  if (profile.role !== "admin") {
    redirect("/forbidden");
  }

  const supabase = createSupabaseServerClient();
  const [
    { data: users },
    { data: prompts },
    { data: cdkRows },
    { data: redeemRows },
    { data: billingLogs },
    { data: appeals },
    { data: riskLogs },
    { data: aiModels },
    { data: quotaReviewEvents, error: quotaReviewError },
    welfareRpc
  ] = await Promise.all([
    supabase
      .from("users")
      .select("id,email,role,status,flash_word_balance,pro_word_balance,workflow_credits")
      .order("email", { ascending: true }),
    supabase.from("ai_prompts").select("id,action_type,name,system_prompt,dify_api_key,is_active").order("action_type"),
    supabase
      .from("cdk_codes")
      .select("id,code,add_flash_word_balance,add_pro_word_balance,add_workflow_credits,is_used,used_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("redeem_codes")
      .select("id,code,flash_word_count,pro_word_count,workflow_count,is_used,used_user_id,used_at,created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("billing_logs")
      .select(
        "id,user_id,cost_words,input_words,output_words,input_tokens,output_tokens,total_tokens,action_type,model_key,created_at,flash_credit,pro_credit"
      )
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase.from("appeals").select("id,user_id,reason,status,admin_note,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("risk_logs").select("user_id,action_taken,created_at").order("created_at", { ascending: false }).limit(500),
    supabase
      .from("ai_models")
      .select("id,model_key,name,action_type,dify_api_key,is_active,sort_order,word_pool,created_at")
      .order("sort_order"),
    supabase
      .from("ai_quota_review_events")
      .select("id,user_id,kind,detail,created_at,resolved_at,resolved_note")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.rpc("admin_welfare_stats_by_user")
  ]);

  const usageMap = new Map<
    string,
    { usedWords: number; requests: number; chatWords: number; generateWords: number; usedTokens: number }
  >();
  for (const log of billingLogs ?? []) {
    if (log.action_type === AI_ACTION_WELFARE_CREDIT) continue;
    const cur = usageMap.get(log.user_id) ?? { usedWords: 0, requests: 0, chatWords: 0, generateWords: 0, usedTokens: 0 };
    cur.usedWords += Number(log.cost_words ?? 0);
    cur.usedTokens += Number(log.total_tokens ?? 0);
    cur.requests += 1;
    if (log.action_type === AI_ACTION_CHAT) cur.chatWords += Number(log.cost_words ?? 0);
    else cur.generateWords += Number(log.cost_words ?? 0);
    usageMap.set(log.user_id, cur);
  }

  const welfareMap = new Map<string, { welfareCount: number; welfareFlashIn: number; welfareProIn: number }>();
  for (const log of billingLogs ?? []) {
    if (log.action_type !== AI_ACTION_WELFARE_CREDIT) continue;
    const cur = welfareMap.get(log.user_id) ?? { welfareCount: 0, welfareFlashIn: 0, welfareProIn: 0 };
    cur.welfareCount += 1;
    cur.welfareFlashIn += Number(log.flash_credit ?? 0);
    cur.welfareProIn += Number(log.pro_credit ?? 0);
    welfareMap.set(log.user_id, cur);
  }

  let welfareByUser: Map<string, { welfareCount: number; welfareFlashIn: number; welfareProIn: number }> = welfareMap;
  let welfareStatsNote =
    "「福利笔数 / 累计入账」当前按最近至多 2000 条账单中的福利行估算。新库请执行 install_all.sql；已有库可从 archive 补跑 day23 以启用全库汇总 RPC。";
  if (!welfareRpc.error && Array.isArray(welfareRpc.data)) {
    const m = new Map<string, { welfareCount: number; welfareFlashIn: number; welfareProIn: number }>();
    for (const row of welfareRpc.data as Array<{
      user_id: string;
      welfare_count: number | string;
      flash_in: number | string;
      pro_in: number | string;
    }>) {
      m.set(row.user_id, {
        welfareCount: Number(row.welfare_count),
        welfareFlashIn: Number(row.flash_in),
        welfareProIn: Number(row.pro_in)
      });
    }
    welfareByUser = m;
    welfareStatsNote = "「福利笔数 / 累计入账」已对 welfare_credit 全库汇总。";
  }

  const riskCountMap = new Map<string, number>();
  for (const r of riskLogs ?? []) {
    riskCountMap.set(r.user_id, (riskCountMap.get(r.user_id) ?? 0) + 1);
  }

  const userEmailMap = new Map<string, string>();
  for (const u of users ?? []) userEmailMap.set(u.id, u.email);

  const quotaReviewRows =
    !quotaReviewError && Array.isArray(quotaReviewEvents)
      ? quotaReviewEvents.map((e) => ({
          id: e.id as string,
          user_id: e.user_id as string,
          userEmail: userEmailMap.get(e.user_id as string) ?? (e.user_id as string),
          kind: String(e.kind ?? ""),
          detail: e.detail,
          created_at: String(e.created_at ?? ""),
          resolved_at: e.resolved_at != null ? String(e.resolved_at) : null,
          resolved_note: e.resolved_note != null ? String(e.resolved_note) : null
        }))
      : [];

  const billingRowsForAdmin = (billingLogs ?? []).map((log) => ({
    id: log.id,
    user_id: log.user_id,
    userEmail: userEmailMap.get(log.user_id) ?? log.user_id,
    action_type: log.action_type,
    model_key: log.model_key ?? null,
    cost_words: Number(log.cost_words ?? 0),
    flash_credit: Number(log.flash_credit ?? 0),
    pro_credit: Number(log.pro_credit ?? 0),
    input_words: Number(log.input_words ?? 0),
    output_words: Number(log.output_words ?? 0),
    input_tokens: Number(log.input_tokens ?? 0),
    output_tokens: Number(log.output_tokens ?? 0),
    total_tokens: Number(log.total_tokens ?? 0),
    created_at: log.created_at
  }));

  return (
    <main className="min-h-screen bg-slate-50">
      <TopNav
        flashWordBalance={profile.flash_word_balance}
        proWordBalance={profile.pro_word_balance}
        workflowCredits={profile.workflow_credits ?? 0}
        title="管理员后台"
        showWritingToolsLink={false}
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h1 className="text-xl font-semibold">管理员控制台</h1>
          <p className="mt-1 text-sm text-slate-500">
            前台按模型返回的阅读+写作合并为字数额度扣减；下方流水含原始用量明细供对账。新环境请在数据库执行 supabase/install_all.sql；存量库若曾使用旧版分档迁移，请按 archive 中说明补跑 day28 等清理脚本。
          </p>
        </section>

        <AdminPromptsSection prompts={prompts ?? []} />

        <AdminModelsSection models={aiModels ?? []} />

        <AdminRedeemCodesSection rows={(redeemRows ?? []).map((r) => ({
          id: r.id as string,
          code: r.code as string,
          flash_word_count: Number(r.flash_word_count ?? 0),
          pro_word_count: Number(r.pro_word_count ?? 0),
          workflow_count: Number(r.workflow_count ?? 0),
          is_used: Boolean(r.is_used),
          used_user_id: r.used_user_id as string | null,
          used_at: r.used_at as string | null,
          created_at: r.created_at as string
        }))} />

        <AdminCdkSection rows={cdkRows ?? []} />

        <AdminWelfareSection
          models={(aiModels ?? []).map((m) => ({
            model_key: m.model_key,
            name: m.name,
            word_pool: m.word_pool === "pro" ? "pro" : "flash"
          }))}
        />

        <AdminBillingLogsSection logs={billingRowsForAdmin} displayLimit={150} />

        <AdminAiQuotaReviewSection rows={quotaReviewRows} />

        <AdminUsersSection
          welfareStatsNote={welfareStatsNote}
          users={(users ?? []).map((u) => ({
            ...u,
            usage: usageMap.get(u.id) ?? { usedWords: 0, requests: 0, chatWords: 0, generateWords: 0, usedTokens: 0 },
            welfare: welfareByUser.get(u.id) ?? { welfareCount: 0, welfareFlashIn: 0, welfareProIn: 0 },
            riskCount: riskCountMap.get(u.id) ?? 0
          }))}
        />

        <AdminAppealsSection appeals={(appeals ?? []).map((a) => ({ ...a, userEmail: userEmailMap.get(a.user_id) ?? a.user_id }))} />

      </div>
    </main>
  );
}
