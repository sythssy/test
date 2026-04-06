# Supabase 数据库迁移

**生产上线全流程**（Vercel、环境变量、区域等）见：[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md)。

## 新项目（推荐）：一个文件装完

在 Supabase **SQL Editor** 中打开并**完整执行**：

- **[`install_all.sql`](./install_all.sql)**

该文件由历史上全部 `day*.sql` **按正确顺序拼接**而成：中间多次出现的 `create or replace function` 是**故意保留**的演进过程（从旧签名/旧逻辑改到新版本），不是笔误。对**空库**从前往后执行一次即可得到与旧「34 个 day 文件」相同的结果。

## 为什么以前有那么多文件？

- 功能是分批上线的：每加一块能力（CDK、双池、扣费 RPC、退款、快照……）就单独存一个脚本，方便**当时**审阅和回滚。
- 对**现在**的维护者来说，在 SQL Editor 里点 30 多次确实麻烦，所以合并成 **`install_all.sql`**。

## 旧全量快照 `000_full_schema.sql`

- 某时刻的**手工汇总**，**不一定**与 `install_all.sql` 逐行一致（例如缺最新 RPC）。
- **新环境请以 `install_all.sql` 为准**；`000_full_schema.sql` 仅作参考。

## 已有数据的生产库

- **不要**对生产库整段重跑 `install_all.sql`（会重复建对象或与存量冲突）。
- 只补跑**当时没执行过**的增量：可到 [`archive/legacy-day-migrations/`](./archive/legacy-day-migrations/) 找到对应的 `dayXX_*.sql` 单独执行，或手写等价 `ALTER` / `CREATE OR REPLACE`。

## 历史碎片文件位置

按天拆分的原始脚本（34 个）在：

[`archive/legacy-day-migrations/`](./archive/legacy-day-migrations/)
