-- 若项目启用了「新表默认 RLS」，管理员需在 cdk_codes 上有读写策略，否则后台无法生成码。
-- 兑换走 redeem_cdk（SECURITY DEFINER），不依赖用户对该表的 SELECT。

alter table if exists public.cdk_codes enable row level security;

drop policy if exists "cdk_codes_select_admin" on public.cdk_codes;
drop policy if exists "cdk_codes_insert_admin" on public.cdk_codes;

create policy "cdk_codes_select_admin"
  on public.cdk_codes for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

create policy "cdk_codes_insert_admin"
  on public.cdk_codes for insert to authenticated
  with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
