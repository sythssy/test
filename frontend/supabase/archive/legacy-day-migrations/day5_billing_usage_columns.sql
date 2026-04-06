-- Day 5: billing_logs 扩展字段（文字明细 + token 统计）
alter table if exists public.billing_logs
  add column if not exists input_words integer not null default 0,
  add column if not exists output_words integer not null default 0,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists total_tokens integer not null default 0;
