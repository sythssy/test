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
