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
