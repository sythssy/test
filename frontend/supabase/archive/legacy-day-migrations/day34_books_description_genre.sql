-- 书籍简介与类型字段
-- 依赖：books 表已存在。

alter table public.books
  add column if not exists description text,
  add column if not exists genre       text;

comment on column public.books.description is '作品简介，最长 500 字';
comment on column public.books.genre       is '作品类型，如 玄幻、言情、悬疑、都市、科幻、武侠、历史、其他';
