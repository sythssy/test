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
