-- 移除 ai_prompts.cost_multiplier：定价通过 Flash/Pro 字数池与 CDK 包规体现。
alter table if exists public.ai_prompts
  drop column if exists cost_multiplier;
