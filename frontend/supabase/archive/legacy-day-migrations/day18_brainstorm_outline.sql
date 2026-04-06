-- 脑洞大纲：按字数计费（action_type = brainstorm_outline）

insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values (
  'brainstorm_outline',
  '脑洞大纲',
  '你是网络小说策划与结构顾问。根据作者给的书名、可选说明与正文摘录，输出偏「脑洞向」的创作大纲：世界观/人设钩子、主线矛盾、分卷或分阶段的节奏节点、可展开的情节点子列表；用 Markdown，条理清晰，不必寒暄，不要写成正文章节。',
  '',
  false
)
on conflict (action_type) do nothing;

insert into public.ai_models (model_key, name, action_type, dify_api_key, sort_order, word_pool)
values ('brainstorm_default', '脑洞大纲（默认）', 'brainstorm_outline', '', 5, 'flash')
on conflict (model_key) do nothing;
