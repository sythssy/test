-- Day 11: 钱包字段加固 — created_at / bigint 升级 / users 表 RLS

-- 1. users 补 created_at
alter table if exists public.users
  add column if not exists created_at timestamptz not null default now();

-- 2. 余额字段升级为 bigint（int8），防大额溢出
alter table if exists public.users
  alter column word_balance set data type bigint,
  alter column workflow_credits set data type bigint;

alter table if exists public.cdk_codes
  alter column add_word_balance set data type bigint,
  alter column add_workflow_credits set data type bigint;

alter table if exists public.billing_logs
  alter column cost_words set data type bigint,
  alter column cost_workflow_credits set data type bigint;

-- 3. users 表 RLS — 普通用户只能读自己，不能直接改余额
alter table if exists public.users enable row level security;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own"
  on public.users for select to authenticated
  using (id = auth.uid());

drop policy if exists "users_select_admin" on public.users;
create policy "users_select_admin"
  on public.users for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "users_update_admin" on public.users;
create policy "users_update_admin"
  on public.users for update to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
