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
