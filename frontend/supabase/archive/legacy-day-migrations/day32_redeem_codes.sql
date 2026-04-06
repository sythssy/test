-- Day 32: redeem_codes — 激活码兑换表（字段按产品规范；一码一用，绑定账号）
-- 与 cdk_codes 并存；新增码走本表，旧存量 cdk_codes 码通过旧 RPC 兑换仍可用。
-- 执行前确认 public.users / public.books 已存在。

create table if not exists public.redeem_codes (
  id               uuid         primary key default gen_random_uuid(),
  code             text         not null unique,
  flash_word_count bigint       not null default 0,
  pro_word_count   bigint       not null default 0,
  workflow_count   bigint       not null default 0,
  is_used          boolean      not null default false,
  used_user_id     uuid         references public.users(id) on delete set null,
  created_at       timestamptz  not null default now(),
  used_at          timestamptz,
  constraint redeem_codes_grant_chk check (
    flash_word_count >= 0
    and pro_word_count >= 0
    and workflow_count >= 0
    and (flash_word_count > 0 or pro_word_count > 0 or workflow_count > 0)
  )
);

create index if not exists idx_redeem_codes_code     on public.redeem_codes(code);
create index if not exists idx_redeem_codes_is_used  on public.redeem_codes(is_used);
create index if not exists idx_redeem_codes_created  on public.redeem_codes(created_at desc);

alter table public.redeem_codes enable row level security;

-- 仅管理员可读写（兑换通过 SECURITY DEFINER 函数，不需要用户直接 SELECT）
drop policy if exists "redeem_codes_select_admin" on public.redeem_codes;
create policy "redeem_codes_select_admin"
  on public.redeem_codes for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "redeem_codes_insert_admin" on public.redeem_codes;
create policy "redeem_codes_insert_admin"
  on public.redeem_codes for insert to authenticated
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- 原子兑换函数：SELECT FOR UPDATE 防并发重复兑换；一码绑定一个 used_user_id
create or replace function public.use_redeem_code(p_code text, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
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

  -- 标记已使用，绑定账号
  update public.redeem_codes
     set is_used      = true,
         used_user_id = p_user_id,
         used_at      = now()
   where id = v_row.id;

  -- 增加用户字数额度
  update public.users
     set flash_word_balance = flash_word_balance + coalesce(v_row.flash_word_count, 0),
         pro_word_balance   = pro_word_balance   + coalesce(v_row.pro_word_count, 0),
         workflow_credits   = workflow_credits    + coalesce(v_row.workflow_count, 0)
   where id = p_user_id;

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
