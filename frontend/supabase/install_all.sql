-- ============================================================
-- 织梦 AI 小说 — 合并安装脚本（由原 day*.sql 按顺序拼接）
-- 用法：在 Supabase SQL Editor 中整文件执行一次（全新空库）。
-- 历史说明见 archive/legacy-day-migrations/README.md
-- ============================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day1_day2_schema.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 1-2 minimal schema for auth + dashboard
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  word_balance integer not null default 50000,
  role text not null default 'user',
  status text not null default 'active'
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  cover_url text,
  current_conversation_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  word_count integer not null default 0,
  order_index integer not null
);

create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  action_type text not null unique,
  name text not null,
  system_prompt text not null,
  dify_api_key text not null,
  is_active boolean not null default true
);

create table if not exists public.billing_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null,
  cost_words integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chapters_book_order on public.chapters(book_id, order_index);
create index if not exists idx_billing_user_time on public.billing_logs(user_id, created_at desc);
create index if not exists idx_users_role on public.users(role);
create index if not exists idx_users_status on public.users(status);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day5_billing_usage_columns.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 5: billing_logs 扩展字段（文字明细 + token 统计）
alter table if exists public.billing_logs
  add column if not exists input_words integer not null default 0,
  add column if not exists output_words integer not null default 0,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists total_tokens integer not null default 0;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day6_prompts_and_risk.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day7_ai_prompts_seed.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 预置 ai_prompts 行（需在 Supabase 中填入 dify_api_key 并将 is_active 设为 true 后才会生效）
-- getPromptRow 在 key 为空或未启用时会返回 PROMPT_NOT_FOUND / PROMPT_INACTIVE

insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values
  ('chat', '侧边栏聊天', '你是小说写作助手，简洁回答作者问题。', '', false),
  ('polish', '选区润色', '润色下列小说正文，保持人称与情节不变，仅优化文笔。', '', false),
  ('expand', '选区扩写', '在下列正文基础上合理扩写，保持风格一致。', '', false),
  ('de_ai', '去 AI 痕迹', '将下列文字改写得更加自然、减少机械感，保留原意。', '', false)
on conflict (action_type) do nothing;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day8_cdk_codes.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 8: CDK 兑换码系统（曾在此加入 ai_prompts.cost_multiplier，已由 day19 删除列）

-- 1. 兑换码表
create table if not exists public.cdk_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  word_value integer not null,
  is_used boolean not null default false,
  used_by uuid references public.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_cdk_code on public.cdk_codes(code);
create index if not exists idx_cdk_is_used on public.cdk_codes(is_used);
create index if not exists idx_cdk_created on public.cdk_codes(created_at desc);

-- 2. 原子兑换函数（SELECT FOR UPDATE 防并发重复兑换）
create or replace function public.redeem_cdk(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_cdk record;
  v_new_balance integer;
begin
  -- 加行锁，防止并发重复兑换
  select id, word_value, is_used
    into v_cdk
    from public.cdk_codes
   where code = p_code
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_NOT_FOUND');
  end if;

  if v_cdk.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_ALREADY_USED');
  end if;

  -- 标记已使用
  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

  -- 增加用户余额
  update public.users
     set word_balance = word_balance + v_cdk.word_value
   where id = p_user_id
  returning word_balance into v_new_balance;

  return jsonb_build_object(
    'ok', true,
    'word_value', v_cdk.word_value,
    'new_balance', v_new_balance
  );
end;
$$;

-- 3. ai_prompts 加倍率字段（1.00 = 基准，2.00 = 两倍扣费）
alter table if exists public.ai_prompts
  add column if not exists cost_multiplier numeric(6,2) not null default 1.00;

comment on column public.ai_prompts.cost_multiplier
  is '扣费倍率：1.00=基准模型，2.00=贵一倍，0.50=半价。实际扣费 = 字数 × 倍率（向上取整）。';

grant execute on function public.redeem_cdk(text, uuid) to authenticated;
grant execute on function public.redeem_cdk(text, uuid) to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day9_cdk_rls.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 若项目启用了「新表默认 RLS」，管理员需在 cdk_codes 上有读写策略，否则后台无法生成码。
-- 兑换走 redeem_cdk（SECURITY DEFINER），不依赖用户对该表的 SELECT。

alter table if exists public.cdk_codes enable row level security;

drop policy if exists "cdk_codes_select_admin" on public.cdk_codes;
drop policy if exists "cdk_codes_insert_admin" on public.cdk_codes;

create policy "cdk_codes_select_admin"
  on public.cdk_codes for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

create policy "cdk_codes_insert_admin"
  on public.cdk_codes for insert to authenticated
  with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day10_dual_wallet.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 10: 双钱包（workflow_credits + word_balance）+ CDK 双字段 + 账单工作流次数字段

alter table if exists public.users
  add column if not exists workflow_credits integer not null default 0;

alter table if exists public.users
  alter column word_balance set default 0;

alter table if exists public.billing_logs
  add column if not exists cost_workflow_credits integer not null default 0;

comment on column public.billing_logs.cost_workflow_credits is '按次计费的能力（如后续整链工作流）记非零；润色/聊天/脑洞大纲等纯字数路径为 0';

alter table if exists public.cdk_codes
  add column if not exists add_word_balance integer not null default 0;

alter table if exists public.cdk_codes
  add column if not exists add_workflow_credits integer not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cdk_codes' and column_name = 'word_value'
  ) then
    update public.cdk_codes
       set add_word_balance = coalesce(word_value, 0)
     where add_word_balance = 0 and coalesce(word_value, 0) > 0;
    alter table public.cdk_codes drop column word_value;
  end if;
end $$;

alter table public.cdk_codes drop constraint if exists cdk_codes_grant_chk;

alter table public.cdk_codes
  add constraint cdk_codes_grant_chk check (
    add_word_balance >= 0
    and add_workflow_credits >= 0
    and (add_word_balance > 0 or add_workflow_credits > 0)
  );

create or replace function public.redeem_cdk(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cdk record;
  v_word integer;
  v_wf integer;
  v_new_word integer;
  v_new_wf integer;
begin
  select id, add_word_balance, add_workflow_credits, is_used
    into v_cdk
    from public.cdk_codes
   where code = p_code
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_NOT_FOUND');
  end if;

  if v_cdk.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_ALREADY_USED');
  end if;

  v_word := coalesce(v_cdk.add_word_balance, 0);
  v_wf := coalesce(v_cdk.add_workflow_credits, 0);

  if v_word <= 0 and v_wf <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_INVALID');
  end if;

  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

  update public.users
     set word_balance = word_balance + v_word,
         workflow_credits = workflow_credits + v_wf
   where id = p_user_id
  returning word_balance, workflow_credits into v_new_word, v_new_wf;

  return jsonb_build_object(
    'ok', true,
    'added_words', v_word,
    'added_workflow', v_wf,
    'new_word_balance', v_new_word,
    'new_workflow_credits', v_new_wf
  );
end;
$$;

grant execute on function public.redeem_cdk(text, uuid) to authenticated;
grant execute on function public.redeem_cdk(text, uuid) to service_role;



-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day11_wallet_hardening.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day12_ai_models.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day14_drop_signup_codes_optional.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 可选：若曾执行过旧版 signup_codes / consume_signup_code，可手动在 SQL Editor 运行以清理
drop function if exists public.consume_signup_code(text);
drop table if exists public.signup_codes;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day15_triple_wallet.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day15: 三资产 — flash_word_balance / pro_word_balance / workflow_credits + CDK 三字段

-- ─── users: 迁移 word_balance → flash_word_balance ───
alter table public.users add column if not exists flash_word_balance bigint not null default 0;
alter table public.users add column if not exists pro_word_balance bigint not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'word_balance'
  ) then
    execute 'update public.users set flash_word_balance = coalesce(word_balance, 0)';
  end if;
end $$;

alter table public.users drop column if exists word_balance;

-- ─── cdk_codes: 迁移 add_word_balance → add_flash + add_pro ───
alter table public.cdk_codes add column if not exists add_flash_word_balance bigint not null default 0;
alter table public.cdk_codes add column if not exists add_pro_word_balance bigint not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cdk_codes' and column_name = 'add_word_balance'
  ) then
    execute 'update public.cdk_codes set add_flash_word_balance = coalesce(add_word_balance, 0)';
  end if;
end $$;

alter table public.cdk_codes drop constraint if exists cdk_codes_grant_chk;
alter table public.cdk_codes drop column if exists add_word_balance;

alter table public.cdk_codes add constraint cdk_codes_grant_chk check (
  add_flash_word_balance >= 0
  and add_pro_word_balance >= 0
  and add_workflow_credits >= 0
  and (
    add_flash_word_balance > 0
    or add_pro_word_balance > 0
    or add_workflow_credits > 0
  )
);

-- ─── redeem_cdk 三资产累加 ───
create or replace function public.redeem_cdk(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cdk record;
  v_flash bigint;
  v_pro bigint;
  v_wf bigint;
  v_new_flash bigint;
  v_new_pro bigint;
  v_new_wf bigint;
begin
  select id, add_flash_word_balance, add_pro_word_balance, add_workflow_credits, is_used
    into v_cdk
    from public.cdk_codes
   where code = p_code
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_NOT_FOUND');
  end if;

  if v_cdk.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_ALREADY_USED');
  end if;

  v_flash := coalesce(v_cdk.add_flash_word_balance, 0);
  v_pro := coalesce(v_cdk.add_pro_word_balance, 0);
  v_wf := coalesce(v_cdk.add_workflow_credits, 0);

  if v_flash <= 0 and v_pro <= 0 and v_wf <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_INVALID');
  end if;

  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

  update public.users
     set flash_word_balance = flash_word_balance + v_flash,
         pro_word_balance = pro_word_balance + v_pro,
         workflow_credits = workflow_credits + v_wf
   where id = p_user_id
  returning flash_word_balance, pro_word_balance, workflow_credits
  into v_new_flash, v_new_pro, v_new_wf;

  return jsonb_build_object(
    'ok', true,
    'added_flash_words', v_flash,
    'added_pro_words', v_pro,
    'added_workflow', v_wf,
    'new_flash_word_balance', v_new_flash,
    'new_pro_word_balance', v_new_pro,
    'new_workflow_credits', v_new_wf
  );
end;
$$;

grant execute on function public.redeem_cdk(text, uuid) to authenticated;
grant execute on function public.redeem_cdk(text, uuid) to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day16_ai_models_word_pool.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day16: ai_models.word_pool — 显式配置扣 Flash 基础字数 vs Pro 高阶字数

alter table public.ai_models
  add column if not exists word_pool text not null default 'flash';

alter table public.ai_models drop constraint if exists ai_models_word_pool_check;
alter table public.ai_models
  add constraint ai_models_word_pool_check check (word_pool in ('flash', 'pro'));

-- 与旧版「model_key 以 _pro / -pro 结尾」规则对齐，便于存量数据
update public.ai_models
set word_pool = 'pro'
where right(lower(trim(model_key)), 4) = '_pro'
   or right(lower(trim(model_key)), 4) = '-pro';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day18_brainstorm_outline.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day19_drop_ai_prompts_cost_multiplier.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 移除 ai_prompts.cost_multiplier：定价通过 Flash/Pro 字数池与 CDK 包规体现。
alter table if exists public.ai_prompts
  drop column if exists cost_multiplier;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day20_debit_ai_word_usage.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 单次链式：校验身份 → 扣 Flash/Pro 字数额度 → 写 billing_logs（同一事务）
create or replace function public.debit_ai_word_usage(
  p_user_id uuid,
  p_pool text,
  p_amount bigint,
  p_action_type text,
  p_model_key text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_input_words integer,
  p_output_words integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flash bigint;
  v_pro bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if p_pool not in ('flash', 'pro') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POOL');
  end if;

  if p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  if p_pool = 'pro' then
    update public.users
    set pro_word_balance = pro_word_balance - p_amount
    where id = p_user_id and pro_word_balance >= p_amount
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  else
    update public.users
    set flash_word_balance = flash_word_balance - p_amount
    where id = p_user_id and flash_word_balance >= p_amount
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key
  ) values (
    p_user_id,
    0,
    p_action_type,
    p_amount,
    p_input_words,
    p_output_words,
    p_input_tokens,
    p_output_tokens,
    p_total_tokens,
    nullif(trim(p_model_key), '')
  );

  return jsonb_build_object(
    'ok', true,
    'flash_word_balance', v_flash,
    'pro_word_balance', v_pro
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

grant execute on function public.debit_ai_word_usage(
  uuid, text, bigint, text, text,
  integer, integer, integer, integer, integer
) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day21_billing_logs_rls.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- billing_logs：用户仅可见本人流水；管理员可见全部。写入仅允许通过 debit_ai_word_usage（SECURITY DEFINER）。
alter table if exists public.billing_logs enable row level security;

drop policy if exists "billing_logs_select_own" on public.billing_logs;
create policy "billing_logs_select_own"
  on public.billing_logs for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "billing_logs_select_admin" on public.billing_logs;
create policy "billing_logs_select_admin"
  on public.billing_logs for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day22_admin_welfare.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 福利入账：按 Flash / Pro 池加字数，写 billing_logs（入账行）；仅管理员可调用
alter table public.billing_logs add column if not exists flash_credit bigint not null default 0;
alter table public.billing_logs add column if not exists pro_credit bigint not null default 0;

create or replace function public.admin_grant_word_welfare(
  p_user_ids uuid[],
  p_flash bigint,
  p_pro bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if coalesce(p_flash, 0) < 0 or coalesce(p_pro, 0) < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  if coalesce(p_flash, 0) = 0 and coalesce(p_pro, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_GRANT');
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USERS');
  end if;

  for v_uid in
    select distinct x from unnest(p_user_ids) as t(x)
  loop
    update public.users
    set
      flash_word_balance = flash_word_balance + coalesce(p_flash, 0),
      pro_word_balance = pro_word_balance + coalesce(p_pro, 0)
    where id = v_uid;

    if found then
      v_applied := v_applied + 1;
      insert into public.billing_logs (
        user_id,
        cost_workflow_credits,
        action_type,
        cost_words,
        input_words,
        output_words,
        input_tokens,
        output_tokens,
        total_tokens,
        model_key,
        flash_credit,
        pro_credit
      ) values (
        v_uid,
        0,
        'welfare_credit',
        0,
        0,
        0,
        0,
        0,
        0,
        null,
        coalesce(p_flash, 0),
        coalesce(p_pro, 0)
      );
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'skipped_unknown_user', v_skipped
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

grant execute on function public.admin_grant_word_welfare(uuid[], bigint, bigint) to authenticated;

comment on function public.admin_grant_word_welfare is '管理员批量加 Flash/Pro 字数额度；账单 action_type=welfare_credit';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day23_admin_welfare_stats.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 管理员：按用户全量汇总福利入账（不受「最近 N 条流水」限制）
create or replace function public.admin_welfare_stats_by_user()
returns table (
  user_id uuid,
  welfare_count bigint,
  flash_in bigint,
  pro_in bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    bl.user_id,
    count(*)::bigint as welfare_count,
    coalesce(sum(bl.flash_credit), 0)::bigint as flash_in,
    coalesce(sum(bl.pro_credit), 0)::bigint as pro_in
  from public.billing_logs bl
  where bl.action_type = 'welfare_credit'
  group by bl.user_id;
end;
$$;

grant execute on function public.admin_welfare_stats_by_user() to authenticated;

comment on function public.admin_welfare_stats_by_user is '管理员查看每位用户福利笔数及累计入账 Flash/Pro（全表聚合）';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day24_knowledge_items.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 用户素材表 knowledge_items：前端已实现 POST/GET/DELETE（/api/knowledge-items）及 /dashboard/knowledge。
-- 全新库也可依赖 000_full_schema.sql 内嵌的同款定义。执行前请确认 public.users / public.books 已存在。

create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  type text not null default 'idea',
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_items_user_id on public.knowledge_items(user_id);
create index if not exists idx_knowledge_items_book_id on public.knowledge_items(book_id);
create index if not exists idx_knowledge_items_created_at on public.knowledge_items(created_at desc);

alter table public.knowledge_items enable row level security;

drop policy if exists "knowledge_items_select_own" on public.knowledge_items;
create policy "knowledge_items_select_own"
  on public.knowledge_items for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "knowledge_items_insert_own" on public.knowledge_items;
create policy "knowledge_items_insert_own"
  on public.knowledge_items for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "knowledge_items_update_own" on public.knowledge_items;
create policy "knowledge_items_update_own"
  on public.knowledge_items for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "knowledge_items_delete_own" on public.knowledge_items;
create policy "knowledge_items_delete_own"
  on public.knowledge_items for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "knowledge_items_select_admin" on public.knowledge_items;
create policy "knowledge_items_select_admin"
  on public.knowledge_items for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day25_paragraph_verify_prompt.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 段落查证：ai_prompts 占位（管理员在后台填 Key、启用；Dify 侧建议开启联网）
insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values (
  'paragraph_verify',
  '段落查证（正文手动）',
  '你是严谨的设定与情节核查助手。作者会提供「当前作品书名」与一段「待查证正文」。若你的环境支持联网检索，请结合可查的公开信息进行核对；若不可用，则仅基于文本逻辑与常识指出疑点。

输出要求：分条列出；标明「与原作/OOC 风险」「时间线」「事实疑点」等类型（如适用）；不确定处写「需人工复核」。不要寒暄，不要编造已证实结论。',
  '',
  false
)
on conflict (action_type) do nothing;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day26_daily_ai_quotas.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 【已由 day27_quota_tiers_and_surcharge.sql 覆盖】若未执行过可保留 word_pool 回填段；否则直接执行 day27 即可。
-- 单日配额：Flash / Pro「输出」累计上限 + 全流程工作流单日调用次数上限
-- 扣费时刻：仅在一次 AI 调用成功、服务端执行 debit 时；用户事后在正文删除/改写不退费。
-- 日界：按 Asia/Shanghai 自然日。

alter table public.billing_logs add column if not exists word_pool text;

comment on column public.billing_logs.word_pool is '本次扣费所属字数池：flash | pro；用于统计单日「模型输出」累计';

-- 历史扣费行尽量回填（便于累计从上线的自然日开始准确）
update public.billing_logs bl
set word_pool = coalesce(am.word_pool::text, 'flash')
from public.ai_models am
where bl.word_pool is null
  and bl.cost_words > 0
  and bl.model_key is not null
  and trim(bl.model_key) = am.model_key;

update public.billing_logs
set word_pool = 'flash'
where word_pool is null and cost_words > 0;

-- ─── 字数扣减：增加按池按日「输出字数」封顶 ─────────────────────────────
create or replace function public.debit_ai_word_usage(
  p_user_id uuid,
  p_pool text,
  p_amount bigint,
  p_action_type text,
  p_model_key text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_input_words integer,
  p_output_words integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flash bigint;
  v_pro bigint;
  v_today_output bigint;
  v_pro_cap constant bigint := 100000;
  v_flash_cap constant bigint := 500000;
  v_day_start timestamptz;
  v_out bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if p_pool not in ('flash', 'pro') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POOL');
  end if;

  if p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  v_out := greatest(coalesce(p_output_words, 0), 0)::bigint;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_today_output
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = p_pool
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  if p_pool = 'pro' then
    if v_today_output + v_out > v_pro_cap then
      return jsonb_build_object(
        'ok', false,
        'error', 'DAILY_OUTPUT_CAP',
        'detail',
        format(
          '「1.5 Pro」通道本日模型输出已累计 %s 字，单日上限 %s 字；本次约写入输出 %s 字，已超过上限。请明日再试或改用 Flash 通道（额度单独统计）。',
          v_today_output, v_pro_cap, v_out
        )
      );
    end if;
  else
    if v_today_output + v_out > v_flash_cap then
      return jsonb_build_object(
        'ok', false,
        'error', 'DAILY_OUTPUT_CAP',
        'detail',
        format(
          '「1.5 Flash」通道本日模型输出已累计 %s 字，单日上限 %s 字；本次约写入输出 %s 字，已超过上限。请明日再试。',
          v_today_output, v_flash_cap, v_out
        )
      );
    end if;
  end if;

  if p_pool = 'pro' then
    update public.users
    set pro_word_balance = pro_word_balance - p_amount
    where id = p_user_id and pro_word_balance >= p_amount
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  else
    update public.users
    set flash_word_balance = flash_word_balance - p_amount
    where id = p_user_id and flash_word_balance >= p_amount
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    0,
    p_action_type,
    p_amount,
    p_input_words,
    p_output_words,
    p_input_tokens,
    p_output_tokens,
    p_total_tokens,
    nullif(trim(p_model_key), ''),
    p_pool
  );

  return jsonb_build_object(
    'ok', true,
    'flash_word_balance', v_flash,
    'pro_word_balance', v_pro
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

-- ─── 全流程工作流：按日最多 30 次；每次扣 1 次创作工作流次数 ─────────────
create or replace function public.debit_workflow_invocation(
  p_user_id uuid,
  p_action_type text default 'workflow_chain'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt bigint;
  v_wf bigint;
  v_day_start timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select count(*) into v_cnt
  from public.billing_logs bl
  where bl.user_id = p_user_id
    and bl.cost_workflow_credits > 0
    and bl.created_at >= v_day_start;

  if v_cnt >= 30 then
    return jsonb_build_object(
      'ok', false,
      'error', 'DAILY_WORKFLOW_CAP',
      'detail', '全流程工作流本日最多调用 30 次（按 Asia/Shanghai 自然日），请明日再试。'
    );
  end if;

  update public.users
  set workflow_credits = workflow_credits - 1
  where id = p_user_id and workflow_credits >= 1
  returning workflow_credits into v_wf;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_BALANCE',
      'detail', '创作工作流次数不足，请先兑换含次数的激活码。'
    );
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    1,
    coalesce(nullif(trim(p_action_type), ''), 'workflow_chain'),
    0,
    0,
    0,
    0,
    0,
    0,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'workflow_credits', v_wf);
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

grant execute on function public.debit_workflow_invocation(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day27_quota_tiers_and_surcharge.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 统一单日配额：Pro 通道模型输出 50 万/池/日；Flash 不设单日输出封顶；工作流 30 次/日；
-- Pro 通道当日累计输出超 30 万字起对本次扣费按 1.2 倍；Pro 大单/高日耗写入 ai_quota_review_events 供后台处理。
-- 日界：Asia/Shanghai。事前若已执行过含 lifetime_recharge_cny / quota_seed_unlocked 的旧版 day27，请再执行 day28_drop_quota_tier_columns.sql。
-- 依赖：day20 debit_ai_word_usage、billing_logs。

alter table public.billing_logs add column if not exists word_pool text;

alter table public.users add column if not exists ai_quota_blocked_until timestamptz;

comment on column public.users.ai_quota_blocked_until is '运营临时冻结 AI/工作流至此时间（脚本刷量等）';

create table if not exists public.ai_quota_review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_note text
);

create index if not exists idx_ai_quota_review_user_time on public.ai_quota_review_events(user_id, created_at desc);

alter table public.ai_quota_review_events enable row level security;

drop policy if exists "ai_quota_review_admin_select" on public.ai_quota_review_events;
create policy "ai_quota_review_admin_select"
  on public.ai_quota_review_events for select
  to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
 );

drop policy if exists "ai_quota_review_admin_update" on public.ai_quota_review_events;
create policy "ai_quota_review_admin_update"
  on public.ai_quota_review_events for update
  to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  )
  with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- 历史行回填 word_pool
update public.billing_logs bl
set word_pool = coalesce(am.word_pool::text, 'flash')
from public.ai_models am
where bl.word_pool is null
  and bl.cost_words > 0
  and bl.model_key is not null
  and trim(bl.model_key) = am.model_key;

update public.billing_logs
set word_pool = 'flash'
where word_pool is null and cost_words > 0;

create or replace function public.compute_effective_debit_words(
  p_today_total_out bigint,
  p_amount bigint,
  p_output_words bigint
)
returns bigint
language plpgsql
immutable
as $$
declare
  v_out bigint := greatest(coalesce(p_output_words, 0), 0);
  v_surcharge_from constant bigint := 300000;
  v_out_1x bigint;
  v_out_12 bigint;
begin
  if p_amount < 0 then
    return 0;
  end if;
  if v_out <= 0 then
    return p_amount;
  end if;
  if p_today_total_out >= v_surcharge_from then
    return ceiling(p_amount::numeric * 1.2)::bigint;
  elsif p_today_total_out + v_out <= v_surcharge_from then
    return p_amount;
  else
    v_out_1x := least(v_out, greatest(v_surcharge_from - p_today_total_out, 0)::bigint);
    v_out_12 := v_out - v_out_1x;
    return ceiling(
      (p_amount::numeric * (v_out_1x::numeric + v_out_12::numeric * 1.2)) / v_out::numeric
    )::bigint;
  end if;
end;
$$;

drop function if exists public.peek_debit_words_needed(uuid, bigint, integer);

create or replace function public.peek_debit_words_needed(
  p_user_id uuid,
  p_amount bigint,
  p_output_words integer,
  p_pool text default 'flash'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tot bigint;
  v_day_start timestamptz;
  v_eff bigint;
  v_pool text;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return -1;
  end if;

  v_pool :=
    case
      when lower(trim(coalesce(p_pool, ''))) = 'pro' then 'pro'
      else 'flash'
    end;

  if v_pool = 'flash' then
    v_eff := p_amount;
    if v_eff < 1 and p_amount > 0 then
      return 1;
    end if;
    return v_eff;
  end if;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_tot
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = 'pro'
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  v_eff := public.compute_effective_debit_words(v_tot, p_amount, greatest(coalesce(p_output_words, 0), 0)::bigint);
  if v_eff < 1 and p_amount > 0 then
    return 1;
  end if;
  return v_eff;
end;
$$;

grant execute on function public.peek_debit_words_needed(uuid, bigint, integer, text) to authenticated;

create or replace function public.debit_ai_word_usage(
  p_user_id uuid,
  p_pool text,
  p_amount bigint,
  p_action_type text,
  p_model_key text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_input_words integer,
  p_output_words integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flash bigint;
  v_pro bigint;
  v_blocked_until timestamptz;
  v_pool_cap constant bigint := 500000;
  v_today_pool_out bigint;
  v_today_pro_out bigint;
  v_out bigint;
  v_day_start timestamptz;
  v_eff bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if p_pool not in ('flash', 'pro') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POOL');
  end if;

  if p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  select u.ai_quota_blocked_until
  into v_blocked_until
  from public.users u
  where u.id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_blocked_until is not null and v_blocked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'QUOTA_ADMIN_HOLD',
      'detail',
      '账号已临时限制 AI 生成至 '
        || to_char(v_blocked_until at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI TZ')
        || '。如有疑问请联系管理员。'
    );
  end if;

  v_out := greatest(coalesce(p_output_words, 0), 0)::bigint;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_today_pool_out
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = p_pool
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  if p_pool = 'pro' and v_today_pool_out + v_out > v_pool_cap then
    return jsonb_build_object(
      'ok', false,
      'error', 'DAILY_OUTPUT_CAP',
      'detail',
      format(
        '本日深度创作引擎输出已累计 %s 字，单日上限 %s 字；本次约 %s 字。请明日再试。',
        v_today_pool_out,
        v_pool_cap,
        v_out
      )
    );
  end if;

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_today_pro_out
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = 'pro'
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  if p_pool = 'pro' and v_out > 50000 then
    insert into public.ai_quota_review_events (user_id, kind, detail)
    values (
      p_user_id,
      'pro_single_output_over_50k',
      jsonb_build_object(
        'output_words', v_out,
        'action_type', p_action_type,
        'model_key', nullif(trim(p_model_key), '')
      )
    );
  end if;

  if p_pool = 'pro' and (v_today_pool_out + v_out > 200000) then
    insert into public.ai_quota_review_events (user_id, kind, detail)
    values (
      p_user_id,
      'pro_daily_output_over_200k',
      jsonb_build_object(
        'today_pro_output_before', v_today_pool_out,
        'this_output', v_out,
        'action_type', p_action_type
      )
    );
  end if;

  if p_pool = 'flash' then
    v_eff := p_amount;
  else
    v_eff := public.compute_effective_debit_words(v_today_pro_out, p_amount, v_out);
  end if;

  if v_eff < 1 and p_amount > 0 then
    v_eff := 1;
  end if;

  if p_pool = 'pro' then
    update public.users
    set pro_word_balance = pro_word_balance - v_eff
    where id = p_user_id and pro_word_balance >= v_eff
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  else
    update public.users
    set flash_word_balance = flash_word_balance - v_eff
    where id = p_user_id and flash_word_balance >= v_eff
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    0,
    p_action_type,
    v_eff,
    p_input_words,
    p_output_words,
    p_input_tokens,
    p_output_tokens,
    p_total_tokens,
    nullif(trim(p_model_key), ''),
    p_pool
  );

  return jsonb_build_object(
    'ok', true,
    'flash_word_balance', v_flash,
    'pro_word_balance', v_pro,
    'quota_charged_effective', v_eff,
    'quota_charged_base', p_amount
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

create or replace function public.debit_workflow_invocation(
  p_user_id uuid,
  p_action_type text default 'workflow_chain'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cnt bigint;
  v_wf bigint;
  v_day_start timestamptz;
  v_cap constant int := 30;
  v_blocked_until timestamptz;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  select u.ai_quota_blocked_until
  into v_blocked_until
  from public.users u
  where u.id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_blocked_until is not null and v_blocked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'QUOTA_ADMIN_HOLD',
      'detail', '账号已临时限制工作流调用，请联系管理员。'
    );
  end if;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select count(*) into v_cnt
  from public.billing_logs bl
  where bl.user_id = p_user_id
    and bl.cost_workflow_credits > 0
    and bl.created_at >= v_day_start;

  if v_cnt >= v_cap then
    return jsonb_build_object(
      'ok', false,
      'error', 'DAILY_WORKFLOW_CAP',
      'detail',
      format('全流程工作流本日最多 %s 次，请明日再试。', v_cap)
    );
  end if;

  update public.users
  set workflow_credits = workflow_credits - 1
  where id = p_user_id and workflow_credits >= 1
  returning workflow_credits into v_wf;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'INSUFFICIENT_BALANCE',
      'detail', '创作工作流次数不足，请先兑换含次数的激活码。'
    );
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    1,
    coalesce(nullif(trim(p_action_type), ''), 'workflow_chain'),
    0,
    0,
    0,
    0,
    0,
    0,
    null,
    null
  );

  return jsonb_build_object('ok', true, 'workflow_credits', v_wf);
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

grant execute on function public.debit_workflow_invocation(uuid, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day28_drop_quota_tier_columns.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 若曾执行过含「累计充值 / 种子满额」分档的旧 day27，本脚本删除已不再使用的列；新环境仅执行新版 day27 则无需本文件。
alter table public.users drop column if exists lifetime_recharge_cny;
alter table public.users drop column if exists quota_seed_unlocked;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day29_flash_no_daily_output_cap.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 若已执行过旧版 day27（含全通道 50 万硬顶、Flash 池日顶）：执行本脚本升级逻辑。
-- Flash：不设单日输出封顶、不参与 Pro 的 30 万字 1.2 倍累计；Pro：保留 50 万/日顶与 30 万起加价。
-- 新库直接执行更新后的 day27 即可，无需再跑本文件。

drop function if exists public.peek_debit_words_needed(uuid, bigint, integer);

create or replace function public.peek_debit_words_needed(
  p_user_id uuid,
  p_amount bigint,
  p_output_words integer,
  p_pool text default 'flash'
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tot bigint;
  v_day_start timestamptz;
  v_eff bigint;
  v_pool text;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return -1;
  end if;

  v_pool :=
    case
      when lower(trim(coalesce(p_pool, ''))) = 'pro' then 'pro'
      else 'flash'
    end;

  if v_pool = 'flash' then
    v_eff := p_amount;
    if v_eff < 1 and p_amount > 0 then
      return 1;
    end if;
    return v_eff;
  end if;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_tot
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = 'pro'
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  v_eff := public.compute_effective_debit_words(v_tot, p_amount, greatest(coalesce(p_output_words, 0), 0)::bigint);
  if v_eff < 1 and p_amount > 0 then
    return 1;
  end if;
  return v_eff;
end;
$$;

grant execute on function public.peek_debit_words_needed(uuid, bigint, integer, text) to authenticated;

create or replace function public.debit_ai_word_usage(
  p_user_id uuid,
  p_pool text,
  p_amount bigint,
  p_action_type text,
  p_model_key text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_input_words integer,
  p_output_words integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flash bigint;
  v_pro bigint;
  v_blocked_until timestamptz;
  v_pool_cap constant bigint := 500000;
  v_today_pool_out bigint;
  v_today_pro_out bigint;
  v_out bigint;
  v_day_start timestamptz;
  v_eff bigint;
begin
  if auth.uid() is null or auth.uid() <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if p_pool not in ('flash', 'pro') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_POOL');
  end if;

  if p_amount < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  select u.ai_quota_blocked_until
  into v_blocked_until
  from public.users u
  where u.id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if v_blocked_until is not null and v_blocked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'QUOTA_ADMIN_HOLD',
      'detail',
      '账号已临时限制 AI 生成至 '
        || to_char(v_blocked_until at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI TZ')
        || '。如有疑问请联系管理员。'
    );
  end if;

  v_out := greatest(coalesce(p_output_words, 0), 0)::bigint;

  v_day_start :=
    (date_trunc('day', clock_timestamp() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai');

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_today_pool_out
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = p_pool
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  if p_pool = 'pro' and v_today_pool_out + v_out > v_pool_cap then
    return jsonb_build_object(
      'ok', false,
      'error', 'DAILY_OUTPUT_CAP',
      'detail',
      format(
        '本日「1.5 Pro」通道模型输出已累计 %s 字，单日上限 %s 字；本次约 %s 字。请明日再试。',
        v_today_pool_out,
        v_pool_cap,
        v_out
      )
    );
  end if;

  select coalesce(sum(greatest(bl.output_words, 0)::bigint), 0)
    into v_today_pro_out
    from public.billing_logs bl
    where bl.user_id = p_user_id
      and bl.word_pool = 'pro'
      and bl.cost_words > 0
      and bl.created_at >= v_day_start;

  if p_pool = 'pro' and v_out > 50000 then
    insert into public.ai_quota_review_events (user_id, kind, detail)
    values (
      p_user_id,
      'pro_single_output_over_50k',
      jsonb_build_object(
        'output_words', v_out,
        'action_type', p_action_type,
        'model_key', nullif(trim(p_model_key), '')
      )
    );
  end if;

  if p_pool = 'pro' and (v_today_pool_out + v_out > 200000) then
    insert into public.ai_quota_review_events (user_id, kind, detail)
    values (
      p_user_id,
      'pro_daily_output_over_200k',
      jsonb_build_object(
        'today_pro_output_before', v_today_pool_out,
        'this_output', v_out,
        'action_type', p_action_type
      )
    );
  end if;

  if p_pool = 'flash' then
    v_eff := p_amount;
  else
    v_eff := public.compute_effective_debit_words(v_today_pro_out, p_amount, v_out);
  end if;

  if v_eff < 1 and p_amount > 0 then
    v_eff := 1;
  end if;

  if p_pool = 'pro' then
    update public.users
    set pro_word_balance = pro_word_balance - v_eff
    where id = p_user_id and pro_word_balance >= v_eff
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  else
    update public.users
    set flash_word_balance = flash_word_balance - v_eff
    where id = p_user_id and flash_word_balance >= v_eff
    returning flash_word_balance, pro_word_balance into v_flash, v_pro;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_BALANCE');
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    0,
    p_action_type,
    v_eff,
    p_input_words,
    p_output_words,
    p_input_tokens,
    p_output_tokens,
    p_total_tokens,
    nullif(trim(p_model_key), ''),
    p_pool
  );

  return jsonb_build_object(
    'ok', true,
    'flash_word_balance', v_flash,
    'pro_word_balance', v_pro,
    'quota_charged_effective', v_eff,
    'quota_charged_base', p_amount
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day30_writing_tool_prompts.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 工具台各生成器在 ai_prompts 中的占位行；管理员填入 dify_api_key、按需改 system_prompt 后将 is_active 置为 true。
insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values
  ('book_title', '书名生成器', '你是中文网文方向的命名顾问。根据用户给的题材、核心梗与风格，输出多组书名，每条带一句推荐理由；避免侵权与其他作品撞名风险提示。输出简洁有条理。', '', false),
  ('book_blurb', '简介生成器', '你是小说文案编辑。根据用户梗概写出吸引点击的简介，可给出标签建议，语气贴合题材。', '', false),
  ('book_outline', '大纲生成器', '你是网文策划。根据用户设定输出可执行的剧情大纲，分阶段列出主要冲突与转折点。', '', false),
  ('fine_outline', '细纲生成器', '你是网文编辑。在用户提供的信息上拆解章节级节拍或场景列表，便于开写。', '', false),
  ('golden_opening', '黄金开篇', '你是小说开篇作者。注重钩子、代入感与信息节制，可示范正文。', '', false),
  ('golden_finger', '金手指生成器', '你是设定策划。设计有边界、有代价的爽点能力或系统，并给情节用法提示。', '', false),
  ('name_gen', '名字生成器', '你擅长各类虚构命名。按用户类型与风格输出一批候选名及极简释义。', '', false),
  ('character_setting', '人设生成器', '你是人物编剧。输出结构化角色卡：动机、缺陷、关系与记忆点。', '', false),
  ('worldview', '世界观生成器', '你是世界观编辑。输出条理清晰的设定概要：规则、势力、矛盾来源。', '', false),
  ('glossary_entry', '词条生成器', '你是设定文档编辑。输出名称+释义+可扩展线索的词条列表。', '', false),
  ('cover_copy', '封面文案', '你协助作者与画师沟通。输出封面 brief：主视觉、配色、字体气质、规避项，可附 slogan。', '', false)
on conflict (action_type) do nothing;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day31_chapters_created_at.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 章节 created_at：编辑器侧栏元数据；与 000_full_schema 增量对齐
alter table public.chapters add column if not exists created_at timestamptz default now();


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day32_redeem_codes.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 32: redeem_codes — 激活码兑换表（字段按产品规范；一码一用，绑定账号）
-- 与 cdk_codes 并存；新增码走本表，旧存量 cdk_codes 码通过旧 RPC 兑换仍可用。
-- 执行前确认 public.users / public.books 已存在。

create table if not exists public.redeem_codes (
  id               uuid         primary key default gen_random_uuid(),
  code             text         not null unique,
  flash_word_count bigint       not null default 0,
  pro_word_count   bigint       not null default 0,
  workflow_count   bigint       not null default 0,
  is_used          boolean      not null default false,
  used_user_id     uuid         references public.users(id) on delete set null,
  created_at       timestamptz  not null default now(),
  used_at          timestamptz,
  constraint redeem_codes_grant_chk check (
    flash_word_count >= 0
    and pro_word_count >= 0
    and workflow_count >= 0
    and (flash_word_count > 0 or pro_word_count > 0 or workflow_count > 0)
  )
);

create index if not exists idx_redeem_codes_code     on public.redeem_codes(code);
create index if not exists idx_redeem_codes_is_used  on public.redeem_codes(is_used);
create index if not exists idx_redeem_codes_created  on public.redeem_codes(created_at desc);

alter table public.redeem_codes enable row level security;

-- 仅管理员可读写（兑换通过 SECURITY DEFINER 函数，不需要用户直接 SELECT）
drop policy if exists "redeem_codes_select_admin" on public.redeem_codes;
create policy "redeem_codes_select_admin"
  on public.redeem_codes for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "redeem_codes_insert_admin" on public.redeem_codes;
create policy "redeem_codes_insert_admin"
  on public.redeem_codes for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- 原子兑换函数：SELECT FOR UPDATE 防并发重复兑换；一码绑定一个 used_user_id
create or replace function public.use_redeem_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select id, flash_word_count, pro_word_count, workflow_count, is_used
    into v_row
    from public.redeem_codes
   where code = p_code
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_NOT_FOUND');
  end if;

  if v_row.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_ALREADY_USED');
  end if;

  if coalesce(v_row.flash_word_count, 0) <= 0
     and coalesce(v_row.pro_word_count, 0) <= 0
     and coalesce(v_row.workflow_count, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_INVALID');
  end if;

  -- 标记已使用，绑定账号
  update public.redeem_codes
     set is_used      = true,
         used_user_id = p_user_id,
         used_at      = now()
   where id = v_row.id;

  -- 增加用户字数额度
  update public.users
     set flash_word_balance = flash_word_balance + coalesce(v_row.flash_word_count, 0),
         pro_word_balance   = pro_word_balance   + coalesce(v_row.pro_word_count, 0),
         workflow_credits   = workflow_credits    + coalesce(v_row.workflow_count, 0)
   where id = p_user_id;

  return jsonb_build_object(
    'ok',                   true,
    'added_flash_words',    v_row.flash_word_count,
    'added_pro_words',      v_row.pro_word_count,
    'added_workflow',       v_row.workflow_count
  );
end;
$$;

grant execute on function public.use_redeem_code(text, uuid) to authenticated;
grant execute on function public.use_redeem_code(text, uuid) to service_role;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day33_chapter_snapshots.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 章节历史快照：保留最近 30 天，每章最多 50 条硬上限，支持一键恢复
-- 依赖：books、chapters、users 表已存在。

create table if not exists public.chapter_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  chapter_id  uuid        not null references public.chapters(id)  on delete cascade,
  book_id     uuid        not null references public.books(id)     on delete cascade,
  user_id     uuid        not null references public.users(id)     on delete cascade,
  label       text,                    -- 可选备注，如 "AI润色前" "手动存档"
  content     jsonb       not null,    -- Tiptap JSON 快照
  word_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chapter_snapshots_chapter_time
  on public.chapter_snapshots(chapter_id, created_at desc);

alter table public.chapter_snapshots enable row level security;

-- 只允许本人读取自己的快照
drop policy if exists "chapter_snapshots_select" on public.chapter_snapshots;
create policy "chapter_snapshots_select"
  on public.chapter_snapshots for select
  to authenticated
  using (user_id = auth.uid());

-- 只允许本人写入
drop policy if exists "chapter_snapshots_insert" on public.chapter_snapshots;
create policy "chapter_snapshots_insert"
  on public.chapter_snapshots for insert
  to authenticated
  with check (user_id = auth.uid());

-- 只允许本人删除
drop policy if exists "chapter_snapshots_delete" on public.chapter_snapshots;
create policy "chapter_snapshots_delete"
  on public.chapter_snapshots for delete
  to authenticated
  using (user_id = auth.uid());

-- ── 可选：pg_cron 每日清理（需 Supabase 项目已启用 pg_cron 扩展） ──────────
-- 每天凌晨 3 点（UTC+8 = UTC 19:00）自动删除 30 天前的快照
-- 如未启用 pg_cron，可跳过此段；应用层每次写入时已执行同等清理。
/*
select cron.schedule(
  'purge_old_chapter_snapshots',
  '0 19 * * *',
  $$
    delete from public.chapter_snapshots
    where created_at < now() - interval '30 days';
  $$
);
*/


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day34_books_description_genre.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 书籍简介与类型字段
-- 依赖：books 表已存在。

alter table public.books
  add column if not exists description text,
  add column if not exists genre       text;

comment on column public.books.description is '作品简介，最长 500 字';
comment on column public.books.genre       is '作品类型，如 玄幻、言情、悬疑、都市、科幻、武侠、历史、其他';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day35_daily_writing_stats.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- 每日写作字数统计表：记录每用户每天新增的字数，用于「今日字数」和「连续创作天数」展示。
-- 依赖：users 表已存在。

create table if not exists public.daily_writing_stats (
  id          uuid  primary key default gen_random_uuid(),
  user_id     uuid  not null references public.users(id) on delete cascade,
  stat_date   date  not null,                 -- 日期（按 Asia/Shanghai 时区）
  words_added integer not null default 0,     -- 当天累计新增字数（只增不减）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, stat_date)
);

create index if not exists idx_daily_writing_stats_user_date
  on public.daily_writing_stats(user_id, stat_date desc);

alter table public.daily_writing_stats enable row level security;

drop policy if exists "daily_writing_stats_select" on public.daily_writing_stats;
create policy "daily_writing_stats_select"
  on public.daily_writing_stats for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "daily_writing_stats_insert" on public.daily_writing_stats;
create policy "daily_writing_stats_insert"
  on public.daily_writing_stats for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "daily_writing_stats_update" on public.daily_writing_stats;
create policy "daily_writing_stats_update"
  on public.daily_writing_stats for update
  to authenticated
  using (user_id = auth.uid());

-- RPC：原子性 upsert，字数只增不减，避免并发写冲突
create or replace function public.upsert_daily_writing_stat(
  p_user_id   uuid,
  p_stat_date date,
  p_delta     integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.daily_writing_stats (user_id, stat_date, words_added, updated_at)
  values (p_user_id, p_stat_date, greatest(p_delta, 0), now())
  on conflict (user_id, stat_date)
  do update
    set words_added = daily_writing_stats.words_added + greatest(excluded.words_added, 0),
        updated_at  = now()
  where greatest(excluded.words_added, 0) > 0;
$$;

grant execute on function public.upsert_daily_writing_stat(uuid, date, integer) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day36_rpc_auth_uid_checks.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 36: 修复三个 SECURITY DEFINER RPC 缺少 auth.uid() = p_user_id 校验的安全漏洞
-- 防止已认证用户通过直连 Supabase 为任意 user_id 兑换码或篡改统计数据

-- ── 1. use_redeem_code：新增 auth.uid() 校验 + users UPDATE 行数校验 ──────────

create or replace function public.use_redeem_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_rows_affected integer;
begin
  -- 仅允许为自己的账号兑换
  if auth.uid() is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  select id, flash_word_count, pro_word_count, workflow_count, is_used
    into v_row
    from public.redeem_codes
   where code = p_code
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_NOT_FOUND');
  end if;

  if v_row.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_ALREADY_USED');
  end if;

  if coalesce(v_row.flash_word_count, 0) <= 0
     and coalesce(v_row.pro_word_count, 0) <= 0
     and coalesce(v_row.workflow_count, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_INVALID');
  end if;

  -- 先加额度，确认用户行存在
  update public.users
     set flash_word_balance = flash_word_balance + coalesce(v_row.flash_word_count, 0),
         pro_word_balance   = pro_word_balance   + coalesce(v_row.pro_word_count, 0),
         workflow_credits   = workflow_credits    + coalesce(v_row.workflow_count, 0)
   where id = p_user_id;

  get diagnostics v_rows_affected = row_count;
  if v_rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error_code', 'USER_NOT_FOUND');
  end if;

  -- 用户行确认更新后再标记码已使用
  update public.redeem_codes
     set is_used      = true,
         used_user_id = p_user_id,
         used_at      = now()
   where id = v_row.id;

  return jsonb_build_object(
    'ok',                   true,
    'added_flash_words',    v_row.flash_word_count,
    'added_pro_words',      v_row.pro_word_count,
    'added_workflow',       v_row.workflow_count
  );
end;
$$;

grant execute on function public.use_redeem_code(text, uuid) to authenticated;
grant execute on function public.use_redeem_code(text, uuid) to service_role;

-- ── 2. redeem_cdk：新增 auth.uid() 校验 + users UPDATE 行数校验 ─────────────

create or replace function public.redeem_cdk(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cdk record;
  v_flash bigint;
  v_pro bigint;
  v_wf bigint;
  v_new_flash bigint;
  v_new_pro bigint;
  v_new_wf bigint;
  v_rows_affected integer;
begin
  -- 仅允许为自己的账号兑换
  if auth.uid() is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  select id, add_flash_word_balance, add_pro_word_balance, add_workflow_credits, is_used
    into v_cdk
    from public.cdk_codes
   where code = p_code
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_NOT_FOUND');
  end if;

  if v_cdk.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_ALREADY_USED');
  end if;

  v_flash := coalesce(v_cdk.add_flash_word_balance, 0);
  v_pro := coalesce(v_cdk.add_pro_word_balance, 0);
  v_wf := coalesce(v_cdk.add_workflow_credits, 0);

  if v_flash <= 0 and v_pro <= 0 and v_wf <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_INVALID');
  end if;

  update public.users
     set flash_word_balance = flash_word_balance + v_flash,
         pro_word_balance = pro_word_balance + v_pro,
         workflow_credits = workflow_credits + v_wf
   where id = p_user_id
  returning flash_word_balance, pro_word_balance, workflow_credits
  into v_new_flash, v_new_pro, v_new_wf;

  get diagnostics v_rows_affected = row_count;
  if v_rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error_code', 'USER_NOT_FOUND');
  end if;

  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

  return jsonb_build_object(
    'ok', true,
    'added_flash_words', v_flash,
    'added_pro_words', v_pro,
    'added_workflow', v_wf,
    'new_flash_word_balance', v_new_flash,
    'new_pro_word_balance', v_new_pro,
    'new_workflow_credits', v_new_wf
  );
end;
$$;

grant execute on function public.redeem_cdk(text, uuid) to authenticated;
grant execute on function public.redeem_cdk(text, uuid) to service_role;

-- ── 3. upsert_daily_writing_stat：新增 auth.uid() 校验 ──────────────────────

create or replace function public.upsert_daily_writing_stat(
  p_user_id   uuid,
  p_stat_date date,
  p_delta     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 仅允许为自己写入统计
  if auth.uid() is distinct from p_user_id then
    raise exception '无权为其他用户写入统计';
  end if;

  insert into public.daily_writing_stats (user_id, stat_date, words_added, updated_at)
  values (p_user_id, p_stat_date, greatest(p_delta, 0), now())
  on conflict (user_id, stat_date)
  do update
    set words_added = daily_writing_stats.words_added + greatest(excluded.words_added, 0),
        updated_at  = now()
  where greatest(excluded.words_added, 0) > 0;
end;
$$;

grant execute on function public.upsert_daily_writing_stat(uuid, date, integer) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day37_refund_ai_overcharge.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 37: 预扣费结算退差 — 生成完成后若实际用量 < 预扣额，退还差额到用户余额
-- 配合 debit_ai_word_usage 使用：先预扣费 → 生成 → 退差

create or replace function public.refund_ai_overcharge(
  p_user_id     uuid,
  p_pool        text,
  p_amount      integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception '无权操作';
  end if;

  if p_amount <= 0 then
    return;
  end if;

  if p_pool = 'pro' then
    update public.users
       set pro_word_balance = pro_word_balance + p_amount
     where id = p_user_id;
  else
    update public.users
       set flash_word_balance = flash_word_balance + p_amount
     where id = p_user_id;
  end if;
end;
$$;

grant execute on function public.refund_ai_overcharge(uuid, text, integer) to authenticated;

-- ── 退还 1 次工作流次数（生成失败时全额退回）────────────────────────────────
create or replace function public.refund_workflow_credit(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from p_user_id then
    raise exception '无权操作';
  end if;

  update public.users
     set workflow_credits = workflow_credits + 1
   where id = p_user_id;
end;
$$;

grant execute on function public.refund_workflow_credit(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day38_refund_visible_billing_logs.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 38: 退还差额写入 billing_logs，用户在使用记录中可见
-- 替换 day37 的 refund_ai_overcharge：余额退回 + 流水（cost_words 为负表示退还字数）

drop function if exists public.refund_ai_overcharge(uuid, text, integer);

create or replace function public.refund_ai_overcharge(
  p_user_id     uuid,
  p_pool        text,
  p_amount      integer,
  p_reason      text default 'settlement'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception '无权操作';
  end if;

  if p_pool not in ('flash', 'pro') then
    raise exception '无效池类型';
  end if;

  if p_amount <= 0 then
    return;
  end if;

  if p_reason = 'aborted' then
    v_action := 'word_refund_aborted';
  else
    v_action := 'word_refund_settlement';
  end if;

  if p_pool = 'pro' then
    update public.users
       set pro_word_balance = pro_word_balance + p_amount
     where id = p_user_id;
  else
    update public.users
       set flash_word_balance = flash_word_balance + p_amount
     where id = p_user_id;
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    0,
    v_action,
    -p_amount::bigint,
    0,
    0,
    0,
    0,
    0,
    null,
    p_pool
  );
end;
$$;

grant execute on function public.refund_ai_overcharge(uuid, text, integer, text) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>
-- FILE: day39_refund_require_user_update.sql
-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>

-- Day 39: refund_ai_overcharge 必须在成功更新用户余额后才写 billing_logs，避免用户不存在时仍插入负流水

create or replace function public.refund_ai_overcharge(
  p_user_id     uuid,
  p_pool        text,
  p_amount      integer,
  p_reason      text default 'settlement'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_n      bigint;
begin
  if auth.uid() is distinct from p_user_id then
    raise exception '无权操作';
  end if;

  if p_pool not in ('flash', 'pro') then
    raise exception '无效池类型';
  end if;

  if p_amount <= 0 then
    return;
  end if;

  if p_reason = 'aborted' then
    v_action := 'word_refund_aborted';
  else
    v_action := 'word_refund_settlement';
  end if;

  if p_pool = 'pro' then
    update public.users
       set pro_word_balance = pro_word_balance + p_amount
     where id = p_user_id;
  else
    update public.users
       set flash_word_balance = flash_word_balance + p_amount
     where id = p_user_id;
  end if;

  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception '退款失败：用户记录不存在或无法更新余额';
  end if;

  insert into public.billing_logs (
    user_id,
    cost_workflow_credits,
    action_type,
    cost_words,
    input_words,
    output_words,
    input_tokens,
    output_tokens,
    total_tokens,
    model_key,
    word_pool
  ) values (
    p_user_id,
    0,
    v_action,
    -p_amount::bigint,
    0,
    0,
    0,
    0,
    0,
    null,
    p_pool
  );
end;
$$;

grant execute on function public.refund_ai_overcharge(uuid, text, integer, text) to authenticated;

