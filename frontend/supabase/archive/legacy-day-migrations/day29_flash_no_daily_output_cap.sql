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
