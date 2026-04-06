"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const profile = await requireAuth();
  if (profile.role !== "admin") throw new Error("FORBIDDEN");
  return profile;
}

export async function generateRedeemCodeBatchAction(formData: FormData) {
  await requireAdmin();
  const flash = Number(formData.get("flash_word_count"));
  const pro = Number(formData.get("pro_word_count"));
  const wf = Number(formData.get("workflow_count"));
  const count = Number(formData.get("count"));

  const f = Number.isFinite(flash) ? Math.max(0, Math.floor(flash)) : 0;
  const p = Number.isFinite(pro) ? Math.max(0, Math.floor(pro)) : 0;
  const w = Number.isFinite(wf) ? Math.max(0, Math.floor(wf)) : 0;

  if (f <= 0 && p <= 0 && w <= 0) {
    return { ok: false as const, error: "极速引擎字数、深度引擎字数与工作流次数至少有一项大于 0" };
  }
  if (!Number.isFinite(count) || count < 1 || count > 200) {
    return { ok: false as const, error: "一次最多生成 200 条，至少 1 条" };
  }

  const supabase = createSupabaseServerClient();
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // 格式：ZDAI-XXXX-XXXX-XXXX（与 VIP-8F92-K1M2 类似，可读性强）
    const hex = randomBytes(6).toString("hex").toUpperCase();
    codes.push(`ZDAI-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
  }

  const rows = codes.map((code) => ({
    code,
    flash_word_count: f,
    pro_word_count: p,
    workflow_count: w
  }));

  const { error } = await supabase.from("redeem_codes").insert(rows);
  if (error) {
    return { ok: false as const, error: error.message };
  }
  revalidatePath("/admin");
  return { ok: true as const, codes };
}
