import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_ACTION_BRAINSTORM_OUTLINE, AI_ACTION_PARAGRAPH_VERIFY } from "@/lib/ai-action-types";
import { BILLING_FLASH_BASE_WORDS_LABEL, BILLING_PRO_ADV_WORDS_LABEL } from "@/lib/billing-labels";

export type WordPool = "flash" | "pro";

export type ResolveModelError = "MODEL_NOT_FOUND" | "MODEL_ACTION_MISMATCH";

export type ResolvedAiModel = {
  model_key: string;
  name: string;
  action_type: string | null;
  dify_api_key: string;
  word_pool: WordPool;
};

/** 兼容：未配置 word_pool 时按 model_key 后缀推断（新库应一律有列） */
export function wordPoolFromModelKey(modelKey: string): WordPool {
  const k = modelKey.trim().toLowerCase();
  if (k.endsWith("_pro") || k.endsWith("-pro")) return "pro";
  return "flash";
}

export function effectiveWordPool(model: { model_key: string; word_pool?: string | null }): WordPool {
  if (model.word_pool === "pro" || model.word_pool === "flash") return model.word_pool;
  return wordPoolFromModelKey(model.model_key);
}

export function insufficientPoolBalanceMessage(
  pool: WordPool,
  context: "generate" | "chat" | "brainstorm" | "paragraph_verify" | "writing_tool"
): string {
  const suffix =
    context === "chat"
      ? "无法继续聊天生成。"
      : context === "brainstorm"
        ? "无法生成脑洞大纲。"
        : context === "paragraph_verify"
          ? "无法完成段落查证。"
          : context === "writing_tool"
            ? "无法使用该写作工具。"
            : "无法继续生成。";
  const label = pool === "pro" ? BILLING_PRO_ADV_WORDS_LABEL : BILLING_FLASH_BASE_WORDS_LABEL;
  return `「${label}」可用字数额度不足，${suffix}`;
}

export async function resolveAiModelForAction(
  supabase: SupabaseClient,
  modelKey: string,
  actionType: string
): Promise<{ ok: true; model: ResolvedAiModel } | { ok: false; code: ResolveModelError }> {
  const key = (modelKey || "").trim() || "default";
  const { data, error } = await supabase
    .from("ai_models")
    .select("model_key,name,action_type,dify_api_key,word_pool")
    .eq("model_key", key)
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, code: "MODEL_NOT_FOUND" };
  }
  if (data.action_type && data.action_type !== actionType) {
    return { ok: false, code: "MODEL_ACTION_MISMATCH" };
  }
  const model: ResolvedAiModel = {
    model_key: data.model_key,
    name: (data.name as string) || data.model_key,
    action_type: data.action_type,
    dify_api_key: data.dify_api_key,
    word_pool: effectiveWordPool(data)
  };
  return { ok: true, model };
}

/** 聊天：先尝试书本当前模型；若与 chat 不适用则回退 default（通用模型） */
export async function resolveAiModelForChat(
  supabase: SupabaseClient,
  currentModelKey: string | null | undefined
): Promise<{ ok: true; model: ResolvedAiModel } | { ok: false; code: ResolveModelError }> {
  const primary = (currentModelKey ?? "").trim() || "default";
  const keys = primary === "default" ? ["default"] : [primary, "default"];
  for (const key of keys) {
    const r = await resolveAiModelForAction(supabase, key, "chat");
    if (r.ok) return r;
  }
  return { ok: false, code: "MODEL_NOT_FOUND" };
}

/** 脑洞大纲：偏好工具栏当前模型；不适用时依次回退 brainstorm_default、default */
export async function resolveAiModelForBrainstorm(
  supabase: SupabaseClient,
  preferredModelKey: string | null | undefined
): Promise<{ ok: true; model: ResolvedAiModel } | { ok: false; code: ResolveModelError }> {
  const primary = (preferredModelKey ?? "").trim() || "default";
  const keys = [...new Set([primary, "brainstorm_default", "default"])];
  for (const key of keys) {
    const r = await resolveAiModelForAction(supabase, key, AI_ACTION_BRAINSTORM_OUTLINE);
    if (r.ok) return r;
  }
  return { ok: false, code: "MODEL_NOT_FOUND" };
}

/** 段落查证：工具栏当前模型 → paragraph_verify_default → default */
export async function resolveAiModelForParagraphVerify(
  supabase: SupabaseClient,
  preferredModelKey: string | null | undefined
): Promise<{ ok: true; model: ResolvedAiModel } | { ok: false; code: ResolveModelError }> {
  const primary = (preferredModelKey ?? "").trim() || "default";
  const keys = [...new Set([primary, "paragraph_verify_default", "default"])];
  for (const key of keys) {
    const r = await resolveAiModelForAction(supabase, key, AI_ACTION_PARAGRAPH_VERIFY);
    if (r.ok) return r;
  }
  return { ok: false, code: "MODEL_NOT_FOUND" };
}

/**
 * 工具台生成器：偏好当前所选模型；不适用时依次回退 writing_tools_default、default（与具体 action_type 匹配或通用模型）。
 */
export async function resolveAiModelForWritingTool(
  supabase: SupabaseClient,
  preferredModelKey: string | null | undefined,
  actionType: string
): Promise<{ ok: true; model: ResolvedAiModel } | { ok: false; code: ResolveModelError }> {
  const primary = (preferredModelKey ?? "").trim() || "default";
  const keys = [...new Set([primary, "writing_tools_default", "default"])];
  for (const key of keys) {
    const r = await resolveAiModelForAction(supabase, key, actionType);
    if (r.ok) return r;
  }
  return { ok: false, code: "MODEL_NOT_FOUND" };
}
