"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function upsertModelAction(formData: FormData) {
  const profile = await requireAuth();
  if (profile.role !== "admin") return { ok: false, error: "无权限" };

  const id = String(formData.get("id") ?? "").trim() || undefined;
  const model_key = String(formData.get("model_key") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const action_type = String(formData.get("action_type") ?? "").trim() || null;
  const dify_api_key = String(formData.get("dify_api_key") ?? "").trim();
  const is_active = formData.get("is_active") === "true";
  const sort_order = parseInt(String(formData.get("sort_order") ?? "0"), 10) || 0;
  const word_pool_raw = String(formData.get("word_pool") ?? "flash").trim();
  const word_pool = word_pool_raw === "pro" ? "pro" : "flash";

  if (!model_key || !name) return { ok: false, error: "model_key 和 name 不能为空" };

  const supabase = createSupabaseServerClient();
  const payload = { model_key, name, action_type, dify_api_key, is_active, sort_order, word_pool };

  const { error } = id
    ? await supabase.from("ai_models").update(payload).eq("id", id)
    : await supabase.from("ai_models").insert(payload);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteModelAction(id: string) {
  const profile = await requireAuth();
  if (profile.role !== "admin") return { ok: false, error: "无权限" };
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("ai_models").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin");
  return { ok: true };
}
