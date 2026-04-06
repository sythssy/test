-- Day 36: 修复三个 SECURITY DEFINER RPC 缺少 auth.uid() = p_user_id 校验的安全漏洞
-- 防止已认证用户通过直连 Supabase 为任意 user_id 兑换码或篡改统计数据

-- ── 1. use_redeem_code：新增 auth.uid() 校验 + users UPDATE 行数校验 ──────────

create or replace function public.use_redeem_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_rows_affected integer;
begin
  -- 仅允许为自己的账号兑换
  if auth.uid() is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

  select id, flash_word_count, pro_word_count, workflow_count, is_used
    into v_row
    from public.redeem_codes
   where code = p_code
     for update;

  if not found then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_NOT_FOUND');
  end if;

  if v_row.is_used then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_ALREADY_USED');
  end if;

  if coalesce(v_row.flash_word_count, 0) <= 0
     and coalesce(v_row.pro_word_count, 0) <= 0
     and coalesce(v_row.workflow_count, 0) <= 0 then
    return jsonb_build_object('ok', false, 'error_code', 'CODE_INVALID');
  end if;

  -- 先加额度，确认用户行存在
  update public.users
     set flash_word_balance = flash_word_balance + coalesce(v_row.flash_word_count, 0),
         pro_word_balance   = pro_word_balance   + coalesce(v_row.pro_word_count, 0),
         workflow_credits   = workflow_credits    + coalesce(v_row.workflow_count, 0)
   where id = p_user_id;

  get diagnostics v_rows_affected = row_count;
  if v_rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error_code', 'USER_NOT_FOUND');
  end if;

  -- 用户行确认更新后再标记码已使用
  update public.redeem_codes
     set is_used      = true,
         used_user_id = p_user_id,
         used_at      = now()
   where id = v_row.id;

  return jsonb_build_object(
    'ok',                   true,
    'added_flash_words',    v_row.flash_word_count,
    'added_pro_words',      v_row.pro_word_count,
    'added_workflow',       v_row.workflow_count
  );
end;
$$;

grant execute on function public.use_redeem_code(text, uuid) to authenticated;
grant execute on function public.use_redeem_code(text, uuid) to service_role;

-- ── 2. redeem_cdk：新增 auth.uid() 校验 + users UPDATE 行数校验 ─────────────

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
  v_rows_affected integer;
begin
  -- 仅允许为自己的账号兑换
  if auth.uid() is distinct from p_user_id then
    return jsonb_build_object('ok', false, 'error_code', 'FORBIDDEN');
  end if;

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

  update public.users
     set flash_word_balance = flash_word_balance + v_flash,
         pro_word_balance = pro_word_balance + v_pro,
         workflow_credits = workflow_credits + v_wf
   where id = p_user_id
  returning flash_word_balance, pro_word_balance, workflow_credits
  into v_new_flash, v_new_pro, v_new_wf;

  get diagnostics v_rows_affected = row_count;
  if v_rows_affected = 0 then
    return jsonb_build_object('ok', false, 'error_code', 'USER_NOT_FOUND');
  end if;

  update public.cdk_codes
     set is_used = true,
         used_by = p_user_id,
         used_at = now()
   where id = v_cdk.id;

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

-- ── 3. upsert_daily_writing_stat：新增 auth.uid() 校验 ──────────────────────

create or replace function public.upsert_daily_writing_stat(
  p_user_id   uuid,
  p_stat_date date,
  p_delta     integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 仅允许为自己写入统计
  if auth.uid() is distinct from p_user_id then
    raise exception '无权为其他用户写入统计';
  end if;

  insert into public.daily_writing_stats (user_id, stat_date, words_added, updated_at)
  values (p_user_id, p_stat_date, greatest(p_delta, 0), now())
  on conflict (user_id, stat_date)
  do update
    set words_added = daily_writing_stats.words_added + greatest(excluded.words_added, 0),
        updated_at  = now()
  where greatest(excluded.words_added, 0) > 0;
end;
$$;

grant execute on function public.upsert_daily_writing_stat(uuid, date, integer) to authenticated;
