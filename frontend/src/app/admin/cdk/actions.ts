"use server";

import { randomBytes } from "crypto";
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

export async function generateCdkBatchAction(formData: FormData) {
  await requireAdmin();
  const addFlash = Number(formData.get("add_flash_word_balance"));
  const addPro = Number(formData.get("add_pro_word_balance"));
  const addWf = Number(formData.get("add_workflow_credits"));
  const count = Number(formData.get("count"));

  const f = Number.isFinite(addFlash) ? Math.max(0, Math.floor(addFlash)) : 0;
  const p = Number.isFinite(addPro) ? Math.max(0, Math.floor(addPro)) : 0;
  const wf = Number.isFinite(addWf) ? Math.max(0, Math.floor(addWf)) : 0;

  if (f <= 0 && p <= 0 && wf <= 0) {
    return { ok: false as const, error: "极速引擎字数、深度引擎字数与次数至少有一项大于 0" };
  }
  if (!Number.isFinite(count) || count < 1 || count > 200) {
    return { ok: false as const, error: "一次最多生成 200 条，至少 1 条" };
  }

  const supabase = createSupabaseServerClient();
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    codes.push(randomBytes(8).toString("hex").toUpperCase());
  }
  const rows = codes.map((code) => ({
    code,
    add_flash_word_balance: f,
    add_pro_word_balance: p,
    add_workflow_credits: wf
  }));
  const { error } = await supabase.from("cdk_codes").insert(rows);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/admin");
  return { ok: true as const, codes };
}
