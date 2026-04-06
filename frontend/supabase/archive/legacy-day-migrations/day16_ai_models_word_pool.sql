-- Day16: ai_models.word_pool — 显式配置扣 Flash 基础字数 vs Pro 高阶字数

alter table public.ai_models
  add column if not exists word_pool text not null default 'flash';

alter table public.ai_models drop constraint if exists ai_models_word_pool_check;
alter table public.ai_models
  add constraint ai_models_word_pool_check check (word_pool in ('flash', 'pro'));

-- 与旧版「model_key 以 _pro / -pro 结尾」规则对齐，便于存量数据
update public.ai_models
set word_pool = 'pro'
where right(lower(trim(model_key)), 4) = '_pro'
   or right(lower(trim(model_key)), 4) = '-pro';
