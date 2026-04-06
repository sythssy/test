"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const profile = await requireAuth();
  if (profile.role !== "admin") {
    throw new Error("FORBIDDEN");
  }
  return profile;
}

export async function upsertPromptAction(formData: FormData) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();

  const id = String(formData.get("id") ?? "").trim();
  const action_type = String(formData.get("action_type") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const system_prompt = String(formData.get("system_prompt") ?? "").trim();
  const dify_api_key = String(formData.get("dify_api_key") ?? "").trim();
  const is_active = formData.get("is_active") === "true";

  if (!action_type || !name || !system_prompt || !dify_api_key) {
    return { ok: false, error: "所有字段均为必填项" };
  }

  if (id) {
    const { error } = await supabase
      .from("ai_prompts")
      .update({ action_type, name, system_prompt, dify_api_key, is_active })
      .eq("id", id);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("ai_prompts")
      .insert({ action_type, name, system_prompt, dify_api_key, is_active });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/admin");
  return { ok: true };
}

export async function deletePromptAction(id: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("ai_prompts").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function banUserAction(userId: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("users")
    .update({ status: "banned" })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function unbanUserAction(userId: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("users")
    .update({ status: "active" })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

/** 额度审核事件：标记已处理（Pro 大单 / 高日耗等） */
export async function resolveAiQuotaReviewAction(eventId: string, note: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("ai_quota_review_events")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_note: note.trim() || null
    })
    .eq("id", eventId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

/** 临时冻结 AI / 工作流至该时间；传 null 清除 */
export async function setUserAiQuotaHoldAction(userId: string, isoUtc: string | null) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("users")
    .update({ ai_quota_blocked_until: isoUtc })
    .eq("id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function handleAppealAction(appealId: string, decision: "approved" | "rejected", note: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();

  const { data: appeal } = await supabase
    .from("appeals")
    .select("user_id")
    .eq("id", appealId)
    .single();

  if (!appeal) return { ok: false, error: "申诉记录不存在" };

  const { error } = await supabase
    .from("appeals")
    .update({ status: decision, admin_note: note })
    .eq("id", appealId);
  if (error) return { ok: false, error: error.message };

  if (decision === "approved") {
    const { error: userErr } = await supabase
      .from("users")
      .update({ status: "active" })
      .eq("id", appeal.user_id);
    if (userErr) {
      return { ok: false, error: userErr.message };
    }
  }

  revalidatePath("/admin");
  return { ok: true };
}
