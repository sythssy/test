# 历史：按天拆分的迁移文件

这些 `day*.sql` 已按顺序合并进仓库根下的 **`../install_all.sql`**。

- **新项目**：只需在 Supabase SQL Editor 执行 **`supabase/install_all.sql`** 一次即可。
- **本目录**：保留是为了 Git 历史、diff 对照；若需单独排查某一天改了什么，可在此查看原始文件。
- **已在跑的生产库**：不要整文件重跑 `install_all.sql`；只补执行当时缺失的增量（从本目录取对应 `dayXX` 或手写 `ALTER`）。
