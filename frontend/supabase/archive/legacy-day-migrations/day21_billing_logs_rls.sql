-- billing_logs：用户仅可见本人流水；管理员可见全部。写入仅允许通过 debit_ai_word_usage（SECURITY DEFINER）。
alter table if exists public.billing_logs enable row level security;

drop policy if exists "billing_logs_select_own" on public.billing_logs;
create policy "billing_logs_select_own"
  on public.billing_logs for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "billing_logs_select_admin" on public.billing_logs;
create policy "billing_logs_select_admin"
  on public.billing_logs for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
