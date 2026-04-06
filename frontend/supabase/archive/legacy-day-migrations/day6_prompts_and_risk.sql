-- Day 6: ai_prompts 索引补充 + risk_logs 风控表

create index if not exists idx_ai_prompts_action_type on public.ai_prompts(action_type);
create index if not exists idx_ai_prompts_is_active on public.ai_prompts(is_active);

-- 风控日志表
create table if not exists public.risk_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null default 'prompt_injection',
  hit_keyword text,
  input_text text,
  action_taken text not null default 'warning',  -- 'warning' | 'banned'
  created_at timestamptz not null default now()
);

create index if not exists idx_risk_logs_user on public.risk_logs(user_id, created_at desc);

-- 申诉表
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',  -- 'pending' | 'approved' | 'rejected'
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appeals_user on public.appeals(user_id);
create index if not exists idx_appeals_status on public.appeals(status);
