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
