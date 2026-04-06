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
