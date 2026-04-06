-- ============================================================
-- ⚠️ 维护提示：新环境请优先执行同目录下的 install_all.sql（含全部历史迁移）。
-- 本文件为旧版手工汇总快照，可能与最新 RPC/表结构不一致，仅作参考。
-- ============================================================
-- 织梦AI小说 — 全量建表脚本（历史快照，约合并至 day11+ 部分后续对象）
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. users 用户核心表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  flash_word_balance bigint not null default 0,
  pro_word_balance bigint not null default 0,
  workflow_credits bigint not null default 0,
  role text not null default 'user',
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists idx_users_role on public.users(role);
create index if not exists idx_users_status on public.users(status);

alter table public.users enable row level security;

create policy "users_select_own"
  on public.users for select to authenticated
  using (id = auth.uid());

create policy "users_select_admin"
  on public.users for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

create policy "users_update_admin"
  on public.users for update to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- 通行证影子账号：auth.users.email 为 *@shadow.local；无独立邮箱/手机注册
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  display_email text;
begin
  display_email := coalesce(
    nullif(trim(new.email), ''),
    'user-' || new.id::text || '@local'
  );
  insert into public.users (id, email)
  values (new.id, display_email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

-- ──────────────────────────────────────────────────────────────
-- 2. books 小说工程表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  cover_url text,
  current_conversation_id text,
  created_at timestamptz not null default now()
);
alter table public.books add column if not exists current_model_key text;

-- ──────────────────────────────────────────────────────────────
-- 3. chapters 章节表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  word_count integer not null default 0,
  order_index integer not null
);

create index if not exists idx_chapters_book_order on public.chapters(book_id, order_index);

alter table public.chapters add column if not exists created_at timestamptz default now();

-- ──────────────────────────────────────────────────────────────
-- 3b. knowledge_items 作品素材库（脑洞等落库；可选但推荐与前端一并启用）
-- ──────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────
-- 4. ai_prompts 后台动态提示词表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  action_type text not null unique,
  name text not null,
  system_prompt text not null,
  dify_api_key text not null,
  is_active boolean not null default true
);

create index if not exists idx_ai_prompts_action_type on public.ai_prompts(action_type);
create index if not exists idx_ai_prompts_is_active on public.ai_prompts(is_active);

insert into public.ai_prompts (action_type, name, system_prompt, dify_api_key, is_active)
values
  ('chat', '侧边栏聊天', '你是小说写作助手，简洁回答作者问题。', '', false),
  ('polish', '选区润色', '润色下列小说正文，保持人称与情节不变，仅优化文笔。', '', false),
  ('expand', '选区扩写', '在下列正文基础上合理扩写，保持风格一致。', '', false),
  ('de_ai', '去 AI 痕迹', '将下列文字改写得更加自然、减少机械感，保留原意。', '', false),
  (
    'brainstorm_outline',
    '脑洞大纲',
    '你是网络小说策划与结构顾问。根据作者给的书名、可选说明与正文摘录，输出偏「脑洞向」的创作大纲：世界观/人设钩子、主线矛盾、分卷或分阶段的节奏节点、可展开的情节点子列表；用 Markdown，条理清晰，不必寒暄，不要写成正文章节。',
    '',
    false
  )
on conflict (action_type) do nothing;

-- ──────────────────────────────────────────────────────────────
-- 5. billing_logs 账单流水表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.billing_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null,
  cost_words bigint not null default 0,
  cost_workflow_credits bigint not null default 0,
  input_words integer not null default 0,
  output_words integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.billing_logs add column if not exists model_key text;

alter table public.billing_logs add column if not exists flash_credit bigint not null default 0;
alter table public.billing_logs add column if not exists pro_credit bigint not null default 0;

comment on column public.billing_logs.cost_workflow_credits is '按次计费的能力（如后续整链工作流）记非零；润色/聊天/脑洞大纲等纯字数路径为 0';
comment on column public.billing_logs.flash_credit is '管理员福利等入账：增加 Flash 池字数（与 cost_words 扣减分开）';
comment on column public.billing_logs.pro_credit is '管理员福利等入账：增加 Pro 池字数';

create index if not exists idx_billing_user_time on public.billing_logs(user_id, created_at desc);

alter table public.billing_logs enable row level security;

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

-- ──────────────────────────────────────────────────────────────
-- 6. cdk_codes 卡密兑换表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.cdk_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  add_flash_word_balance bigint not null default 0,
  add_pro_word_balance bigint not null default 0,
  add_workflow_credits bigint not null default 0,
  is_used boolean not null default false,
  used_by uuid references public.users(id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint cdk_codes_grant_chk check (
    add_flash_word_balance >= 0
    and add_pro_word_balance >= 0
    and add_workflow_credits >= 0
    and (
      add_flash_word_balance > 0
      or add_pro_word_balance > 0
      or add_workflow_credits > 0
    )
  )
);

create index if not exists idx_cdk_code on public.cdk_codes(code);
create index if not exists idx_cdk_is_used on public.cdk_codes(is_used);
create index if not exists idx_cdk_created on public.cdk_codes(created_at desc);

alter table public.cdk_codes enable row level security;

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

-- ──────────────────────────────────────────────────────────────
-- 7. redeem_cdk 原子兑换函数（双钱包版）
-- ──────────────────────────────────────────────────────────────
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

-- ──────────────────────────────────────────────────────────────
-- 8. risk_logs 风控日志表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.risk_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null default 'prompt_injection',
  hit_keyword text,
  input_text text,
  action_taken text not null default 'warning',
  created_at timestamptz not null default now()
);

create index if not exists idx_risk_logs_user on public.risk_logs(user_id, created_at desc);

-- ──────────────────────────────────────────────────────────────
-- 9. appeals 申诉表
-- ──────────────────────────────────────────────────────────────
create table if not exists public.appeals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  admin_note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_appeals_user on public.appeals(user_id);
create index if not exists idx_appeals_status on public.appeals(status);

-- ──────────────────────────────────────────────────────────────
-- 10. ai_models 动态模型路由（含 word_pool 扣费池）
-- ──────────────────────────────────────────────────────────────
create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  model_key text not null unique,
  name text not null,
  action_type text,
  dify_api_key text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  word_pool text not null default 'flash',
  created_at timestamptz not null default now()
);

alter table public.ai_models add column if not exists word_pool text not null default 'flash';

alter table public.ai_models drop constraint if exists ai_models_word_pool_check;
alter table public.ai_models
  add constraint ai_models_word_pool_check check (word_pool in ('flash', 'pro'));

alter table public.ai_models enable row level security;

drop policy if exists "ai_models_select_active" on public.ai_models;
create policy "ai_models_select_active" on public.ai_models
  for select using (is_active = true or (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  ));

drop policy if exists "ai_models_all_admin" on public.ai_models;
create policy "ai_models_all_admin" on public.ai_models
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

insert into public.ai_models (model_key, name, action_type, dify_api_key, sort_order, word_pool) values
  ('default',      '默认通用模型',   null,      '', 0, 'flash'),
  ('polish_fast',  '润色快速版',     'polish',  '', 1, 'flash'),
  ('expand_pro',   '扩写专业版',     'expand',  '', 2, 'pro'),
  ('de_ai_lite',   '去痕轻量版',     'de_ai',   '', 3, 'flash'),
  ('brainstorm_default', '脑洞大纲（默认）', 'brainstorm_outline', '', 5, 'flash')
on conflict (model_key) do nothing;

-- （与 day20_debit_ai_word_usage.sql 一致）原子扣费 + 记账
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

-- 福利入账（day22）：管理员批量加字，action_type = welfare_credit
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

-- 福利汇总（day23）：后台用户表「福利笔数 / 累计入账」全量
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

-- AI 用量全量汇总（day24）
create or replace function public.admin_ai_usage_stats_by_user()
returns table (
  user_id uuid,
  request_count bigint,
  used_words bigint,
  used_tokens bigint,
  chat_words bigint,
  generate_words bigint
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
    count(*)::bigint as request_count,
    coalesce(sum(bl.cost_words), 0)::bigint as used_words,
    coalesce(sum(bl.total_tokens), 0)::bigint as used_tokens,
    coalesce(sum(case when bl.action_type = 'chat' then bl.cost_words else 0 end), 0)::bigint as chat_words,
    coalesce(sum(case when bl.action_type = 'chat' then 0 else bl.cost_words end), 0)::bigint as generate_words
  from public.billing_logs bl
  where bl.action_type <> 'welfare_credit'
  group by bl.user_id;
end;
$$;

grant execute on function public.admin_ai_usage_stats_by_user() to authenticated;
