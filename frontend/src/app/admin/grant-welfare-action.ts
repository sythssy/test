"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function grantWordWelfareAction(formData: FormData): Promise<
  | { ok: true; applied: number; skipped: number; flash: number; pro: number }
  | { ok: false; error: string }
> {
  const profile = await requireAuth();
  if (profile.role !== "admin") {
    return { ok: false, error: "无权限" };
  }

  const rawIds = String(formData.get("user_ids") ?? "");
  const ids = Array.from(
    new Set(
      rawIds
        .split(/[\s,;]+/g)
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s))
    )
  );

  if (ids.length === 0) {
    return { ok: false, error: "请填写至少一个有效用户 UUID（每行一个或逗号分隔）" };
  }

  const supabase = createSupabaseServerClient();
  const { data: models } = await supabase.from("ai_models").select("model_key,word_pool");
  let flash = 0;
  let pro = 0;
  for (const m of models ?? []) {
    const raw = formData.get(`grant_${m.model_key}`);
    const v = Number(raw ?? 0);
    if (!Number.isFinite(v) || v < 0) continue;
    const n = Math.floor(v);
    if (n === 0) continue;
    if (m.word_pool === "pro") pro += n;
    else flash += n;
  }

  if (flash === 0 && pro === 0) {
    return { ok: false, error: "请在下方至少一栏填写赠送字数（按引擎归属汇总）" };
  }

  const { data, error } = await supabase.rpc("admin_grant_word_welfare", {
    p_user_ids: ids,
    p_flash: flash,
    p_pro: pro
  });

  if (error) {
    const msg = error.message ?? "";
    if (/admin_grant_word_welfare|function.*does not exist/i.test(msg)) {
      return {
        ok: false,
        error:
          "数据库未安装福利函数。请在 Supabase 执行 supabase/install_all.sql（新库）或 archive 中对应迁移。"
      };
    }
    return { ok: false, error: msg || "发放失败" };
  }

  const row = data as {
    ok?: boolean;
    error?: string;
    applied?: number;
    skipped_unknown_user?: number;
  };
  if (!row?.ok) {
    if (row?.error === "FORBIDDEN") return { ok: false, error: "无权限（需管理员）" };
    return { ok: false, error: row?.error ?? "发放失败" };
  }

  revalidatePath("/admin");
  return {
    ok: true,
    applied: row.applied ?? 0,
    skipped: row.skipped_unknown_user ?? 0,
    flash,
    pro
  };
}
