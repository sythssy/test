-- Day 12: ai_models table for dynamic Dify routing

create table if not exists public.ai_models (
  id              uuid primary key default gen_random_uuid(),
  model_key       text not null unique,
  name            text not null,
  action_type     text,           -- null = universal model
  dify_api_key    text not null default '',
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now()
);

-- Admin can do everything; users can only read active rows
alter table public.ai_models enable row level security;

create policy "ai_models_select_active" on public.ai_models
  for select using (is_active = true or (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  ));

create policy "ai_models_all_admin" on public.ai_models
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- Add model_key column to billing_logs for cost analysis
alter table public.billing_logs
  add column if not exists model_key text;

-- Add current_model_key to books so per-book preference is persisted
alter table public.books
  add column if not exists current_model_key text;

-- Seed some example rows (update dify_api_key as needed)
insert into public.ai_models (model_key, name, action_type, dify_api_key, sort_order) values
  ('default',      '默认通用模型',   null,      '', 0),
  ('polish_fast',  '润色快速版',     'polish',  '', 1),
  ('expand_pro',   '扩写专业版',     'expand',  '', 2),
  ('de_ai_lite',   '去痕轻量版',     'de_ai',   '', 3),
  ('brainstorm_default', '脑洞大纲（默认）', 'brainstorm_outline', '', 5)
on conflict (model_key) do nothing;
