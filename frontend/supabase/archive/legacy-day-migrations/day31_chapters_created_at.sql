-- 章节 created_at：编辑器侧栏元数据；与 000_full_schema 增量对齐
alter table public.chapters add column if not exists created_at timestamptz default now();
