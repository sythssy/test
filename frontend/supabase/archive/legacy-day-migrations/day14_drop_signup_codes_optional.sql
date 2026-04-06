-- 可选：若曾执行过旧版 signup_codes / consume_signup_code，可手动在 SQL Editor 运行以清理
drop function if exists public.consume_signup_code(text);
drop table if exists public.signup_codes;
