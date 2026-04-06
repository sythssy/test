-- 用户素材表 knowledge_items：前端已实现 POST/GET/DELETE（/api/knowledge-items）及 /dashboard/knowledge。
-- 全新库也可依赖 000_full_schema.sql 内嵌的同款定义。执行前请确认 public.users / public.books 已存在。

create table if not exists public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  type text not null default 'idea',
  title text not null,
  content text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_knowledge_items_user_id on public.knowledge_items(user_id);
create index if not exists idx_knowledge_items_book_id on public.knowledge_items(book_id);
create index if not exists idx_knowledge_items_created_at on public.knowledge_items(created_at desc);

alter table public.knowledge_items enable row level security;

drop policy if exists "knowledge_items_select_own" on public.knowledge_items;
create policy "knowledge_items_select_own"
  on public.knowledge_items for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "knowledge_items_insert_own" on public.knowledge_items;
create policy "knowledge_items_insert_own"
  on public.knowledge_items for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "knowledge_items_update_own" on public.knowledge_items;
create policy "knowledge_items_update_own"
  on public.knowledge_items for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "knowledge_items_delete_own" on public.knowledge_items;
create policy "knowledge_items_delete_own"
  on public.knowledge_items for delete to authenticated
  using (user_id = auth.uid());

drop policy if exists "knowledge_items_select_admin" on public.knowledge_items;
create policy "knowledge_items_select_admin"
  on public.knowledge_items for select to authenticated
  using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
