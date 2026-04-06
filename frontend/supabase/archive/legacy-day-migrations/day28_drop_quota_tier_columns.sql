-- 若曾执行过含「累计充值 / 种子满额」分档的旧 day27，本脚本删除已不再使用的列；新环境仅执行新版 day27 则无需本文件。
alter table public.users drop column if exists lifetime_recharge_cny;
alter table public.users drop column if exists quota_seed_unlocked;
