-- Day 1-2 minimal schema for auth + dashboard
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  word_balance integer not null default 50000,
  role text not null default 'user',
  status text not null default 'active'
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  cover_url text,
  current_conversation_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.chapters (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  title text not null,
  content jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}',
  word_count integer not null default 0,
  order_index integer not null
);

create table if not exists public.ai_prompts (
  id uuid primary key default gen_random_uuid(),
  action_type text not null unique,
  name text not null,
  system_prompt text not null,
  dify_api_key text not null,
  is_active boolean not null default true
);

create table if not exists public.billing_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action_type text not null,
  cost_words integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chapters_book_order on public.chapters(book_id, order_index);
create index if not exists idx_billing_user_time on public.billing_logs(user_id, created_at desc);
create index if not exists idx_users_role on public.users(role);
create index if not exists idx_users_status on public.users(status);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
