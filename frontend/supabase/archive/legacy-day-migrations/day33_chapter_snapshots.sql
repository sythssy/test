-- 章节历史快照：保留最近 30 天，每章最多 50 条硬上限，支持一键恢复
-- 依赖：books、chapters、users 表已存在。

create table if not exists public.chapter_snapshots (
  id          uuid        primary key default gen_random_uuid(),
  chapter_id  uuid        not null references public.chapters(id)  on delete cascade,
  book_id     uuid        not null references public.books(id)     on delete cascade,
  user_id     uuid        not null references public.users(id)     on delete cascade,
  label       text,                    -- 可选备注，如 "AI润色前" "手动存档"
  content     jsonb       not null,    -- Tiptap JSON 快照
  word_count  integer     not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists idx_chapter_snapshots_chapter_time
  on public.chapter_snapshots(chapter_id, created_at desc);

alter table public.chapter_snapshots enable row level security;

-- 只允许本人读取自己的快照
drop policy if exists "chapter_snapshots_select" on public.chapter_snapshots;
create policy "chapter_snapshots_select"
  on public.chapter_snapshots for select
  to authenticated
  using (user_id = auth.uid());

-- 只允许本人写入
drop policy if exists "chapter_snapshots_insert" on public.chapter_snapshots;
create policy "chapter_snapshots_insert"
  on public.chapter_snapshots for insert
  to authenticated
  with check (user_id = auth.uid());

-- 只允许本人删除
drop policy if exists "chapter_snapshots_delete" on public.chapter_snapshots;
create policy "chapter_snapshots_delete"
  on public.chapter_snapshots for delete
  to authenticated
  using (user_id = auth.uid());

-- ── 可选：pg_cron 每日清理（需 Supabase 项目已启用 pg_cron 扩展） ──────────
-- 每天凌晨 3 点（UTC+8 = UTC 19:00）自动删除 30 天前的快照
-- 如未启用 pg_cron，可跳过此段；应用层每次写入时已执行同等清理。
/*
select cron.schedule(
  'purge_old_chapter_snapshots',
  '0 19 * * *',
  $$
    delete from public.chapter_snapshots
    where created_at < now() - interval '30 days';
  $$
);
*/
