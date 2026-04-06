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
