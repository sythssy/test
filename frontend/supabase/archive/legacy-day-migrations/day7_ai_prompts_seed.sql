-- 预置 ai_prompts 行（需在 Supabase 中填入 dify_api_key 并将 is_active 设为 true 后才会生效）
-- getPromptRow 在 key 为空或未启用时会返回 PROMPT_NOT_FOUND / PROMPT_INACTIVE

insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values
  ('chat', '侧边栏聊天', '你是小说写作助手，简洁回答作者问题。', '', false),
  ('polish', '选区润色', '润色下列小说正文，保持人称与情节不变，仅优化文笔。', '', false),
  ('expand', '选区扩写', '在下列正文基础上合理扩写，保持风格一致。', '', false),
  ('de_ai', '去 AI 痕迹', '将下列文字改写得更加自然、减少机械感，保留原意。', '', false)
on conflict (action_type) do nothing;
