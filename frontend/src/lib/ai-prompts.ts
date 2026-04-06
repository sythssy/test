import type { SupabaseClient } from "@supabase/supabase-js";

export class PromptConfigError extends Error {
  code: "PROMPT_NOT_FOUND" | "PROMPT_INACTIVE";

  constructor(code: "PROMPT_NOT_FOUND" | "PROMPT_INACTIVE", message: string) {
    super(message);
    this.name = "PromptConfigError";
    this.code = code;
  }
}

export async function getPromptRow(supabase: SupabaseClient, actionType: string) {
  const { data, error } = await supabase
    .from("ai_prompts")
    .select("action_type,system_prompt,dify_api_key,is_active")
    .eq("action_type", actionType)
    .single();

  if (error || !data) {
    throw new PromptConfigError("PROMPT_NOT_FOUND", `未找到 action_type=${actionType} 的提示词配置`);
  }
  if (!data.is_active) {
    throw new PromptConfigError("PROMPT_INACTIVE", `action_type=${actionType} 的提示词配置未启用`);
  }
  if (!data.dify_api_key?.trim()) {
    throw new PromptConfigError("PROMPT_NOT_FOUND", `action_type=${actionType} 缺少 Dify API Key`);
  }

  return data;
}
