-- Day 10: 双钱包（workflow_credits + word_balance）+ CDK 双字段 + 账单工作流次数字段

alter table if exists public.users
  add column if not exists workflow_credits integer not null default 0;

alter table if exists public.users
  alter column word_balance set default 0;

alter table if exists public.billing_logs
  add column if not exists cost_workflow_credits integer not null default 0;

comment on column public.billing_logs.cost_workflow_credits is '按次计费的能力（如后续整链工作流）记非零；润色/聊天/脑洞大纲等纯字数路径为 0';

alter table if exists public.cdk_codes
  add column if not exists add_word_balance integer not null default 0;

alter table if exists public.cdk_codes
  add column if not exists add_workflow_credits integer not null default 0;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'cdk_codes' and column_name = 'word_value'
  ) then
    update public.cdk_codes
       set add_word_balance = coalesce(word_value, 0)
     where add_word_balance = 0 and coalesce(word_value, 0) > 0;
    alter table public.cdk_codes drop column word_value;
  end if;
end $$;

alter table public.cdk_codes drop constraint if exists cdk_codes_grant_chk;

alter table public.cdk_codes
  add constraint cdk_codes_grant_chk check (
    add_word_balance >= 0
    and add_workflow_credits >= 0
    and (add_word_balance > 0 or add_workflow_credits > 0)
  );

create or replace function public.redeem_cdk(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cdk record;
  v_word integer;
  v_wf integer;
  v_new_word integer;
  v_new_wf integer;
begin
  select id, add_word_balance, add_workflow_credits, is_used
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

  v_word := coalesce(v_cdk.add_word_balance, 0);
  v_wf := coalesce(v_cdk.add_workflow_credits, 0);

  if v_word <= 0 and v_wf <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CDK_INVALID');
  end if;

  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

  update public.users
     set word_balance = word_balance + v_word,
         workflow_credits = workflow_credits + v_wf
   where id = p_user_id
  returning word_balance, workflow_credits into v_new_word, v_new_wf;

  return jsonb_build_object(
    'ok', true,
    'added_words', v_word,
    'added_workflow', v_wf,
    'new_word_balance', v_new_word,
    'new_workflow_credits', v_new_wf
  );
end;
$$;

grant execute on function public.redeem_cdk(text, uuid) to authenticated;
grant execute on function public.redeem_cdk(text, uuid) to service_role;

