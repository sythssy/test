-- 管理员：按用户全量汇总福利入账（不受「最近 N 条流水」限制）
create or replace function public.admin_welfare_stats_by_user()
returns table (
  user_id uuid,
  welfare_count bigint,
  flash_in bigint,
  pro_in bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'
  ) then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    bl.user_id,
    count(*)::bigint as welfare_count,
    coalesce(sum(bl.flash_credit), 0)::bigint as flash_in,
    coalesce(sum(bl.pro_credit), 0)::bigint as pro_in
  from public.billing_logs bl
  where bl.action_type = 'welfare_credit'
  group by bl.user_id;
end;
$$;

grant execute on function public.admin_welfare_stats_by_user() to authenticated;

comment on function public.admin_welfare_stats_by_user is '管理员查看每位用户福利笔数及累计入账 Flash/Pro（全表聚合）';
