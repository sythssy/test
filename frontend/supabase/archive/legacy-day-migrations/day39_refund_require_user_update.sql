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
