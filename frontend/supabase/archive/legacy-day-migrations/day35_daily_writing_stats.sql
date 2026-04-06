-- 每日写作字数统计表：记录每用户每天新增的字数，用于「今日字数」和「连续创作天数」展示。
-- 依赖：users 表已存在。

create table if not exists public.daily_writing_stats (
  id          uuid  primary key default gen_random_uuid(),
  user_id     uuid  not null references public.users(id) on delete cascade,
  stat_date   date  not null,                 -- 日期（按 Asia/Shanghai 时区）
  words_added integer not null default 0,     -- 当天累计新增字数（只增不减）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, stat_date)
);

create index if not exists idx_daily_writing_stats_user_date
  on public.daily_writing_stats(user_id, stat_date desc);

alter table public.daily_writing_stats enable row level security;

drop policy if exists "daily_writing_stats_select" on public.daily_writing_stats;
create policy "daily_writing_stats_select"
  on public.daily_writing_stats for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "daily_writing_stats_insert" on public.daily_writing_stats;
create policy "daily_writing_stats_insert"
  on public.daily_writing_stats for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "daily_writing_stats_update" on public.daily_writing_stats;
create policy "daily_writing_stats_update"
  on public.daily_writing_stats for update
  to authenticated
  using (user_id = auth.uid());

-- RPC：原子性 upsert，字数只增不减，避免并发写冲突
create or replace function public.upsert_daily_writing_stat(
  p_user_id   uuid,
  p_stat_date date,
  p_delta     integer
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.daily_writing_stats (user_id, stat_date, words_added, updated_at)
  values (p_user_id, p_stat_date, greatest(p_delta, 0), now())
  on conflict (user_id, stat_date)
  do update
    set words_added = daily_writing_stats.words_added + greatest(excluded.words_added, 0),
        updated_at  = now()
  where greatest(excluded.words_added, 0) > 0;
$$;

grant execute on function public.upsert_daily_writing_stat(uuid, date, integer) to authenticated;
