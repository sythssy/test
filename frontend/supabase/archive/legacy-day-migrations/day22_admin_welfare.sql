-- 福利入账：按 Flash / Pro 池加字数，写 billing_logs（入账行）；仅管理员可调用
alter table public.billing_logs add column if not exists flash_credit bigint not null default 0;
alter table public.billing_logs add column if not exists pro_credit bigint not null default 0;

create or replace function public.admin_grant_word_welfare(
  p_user_ids uuid[],
  p_flash bigint,
  p_pro bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_applied integer := 0;
  v_skipped integer := 0;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  end if;

  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
  ) then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  end if;

  if coalesce(p_flash, 0) < 0 or coalesce(p_pro, 0) < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT');
  end if;

  if coalesce(p_flash, 0) = 0 and coalesce(p_pro, 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'EMPTY_GRANT');
  end if;

  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USERS');
  end if;

  for v_uid in
    select distinct x from unnest(p_user_ids) as t(x)
  loop
    update public.users
    set
      flash_word_balance = flash_word_balance + coalesce(p_flash, 0),
      pro_word_balance = pro_word_balance + coalesce(p_pro, 0)
    where id = v_uid;

    if found then
      v_applied := v_applied + 1;
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
        flash_credit,
        pro_credit
      ) values (
        v_uid,
        0,
        'welfare_credit',
        0,
        0,
        0,
        0,
        0,
        0,
        null,
        coalesce(p_flash, 0),
        coalesce(p_pro, 0)
      );
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'applied', v_applied,
    'skipped_unknown_user', v_skipped
  );
exception when others then
  return jsonb_build_object(
    'ok', false,
    'error', 'INTERNAL_ERROR',
    'detail', sqlerrm
  );
end;
$$;

grant execute on function public.admin_grant_word_welfare(uuid[], bigint, bigint) to authenticated;

comment on function public.admin_grant_word_welfare is '管理员批量加 Flash/Pro 字数额度；账单 action_type=welfare_credit';
