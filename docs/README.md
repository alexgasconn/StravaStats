# StravaStats v2 文档中心

| 字段 | 内容 |
| --- | --- |
| Status | Active |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Code baseline | `8b16ebe1a706f1713602ab5266e47000caf31a17` |

## 1. 目的

本目录是 StravaStats v2 的长期事实来源，用于保存产品边界、工程规则、架构决策、测试策略、迁移保护和单个 PR 的执行证据。聊天记录、临时提示词和代码注释可以提供背景，但不能替代这里的正式资料。

StravaStats v2 的目标是把当前依赖 Strava API 的仪表盘渐进迁移为本地优先、来源中立的运动数据分析应用，同时保留 Dashboard、Run、Bike、Swim、Activities、Activity Detail、Run Plus 和 NSM 的现有行为。

## 2. 事实来源优先级

资料冲突时按以下顺序处理：

1. 数据安全、隐私和非破坏性迁移约束；
2. `Accepted` 状态的 ADR；
3. [产品需求文档](./product/stravastats-v2-prd.md)；
4. [工程开发计划](./engineering/v2-development-plan.md)；
5. 当前 PR 的 Task Brief；
6. 已验证的当前运行时行为；
7. 旧文档、代码注释和历史讨论。

Task Brief 可以缩小某个 PR 的范围，但不能静默推翻 ADR、PRD 或数据安全约束。若实现需要改变已接受的架构决策，必须暂停任务并提交新的 ADR 或修订提案。

## 3. 文档地图

### 产品

- [StravaStats v2 PRD](./product/stravastats-v2-prd.md)

### 工程

- [V2 工程开发计划](./engineering/v2-development-plan.md)
- [Git 与 Worktree 工作流](./engineering/git-worktree-workflow.md)
- [Release Gates](./engineering/release-gates.md)

### 架构

- [V2 架构总览](./architecture/overview.md)
- [ADR-0001：Canonical Activity](./architecture/adr/0001-canonical-activity.md)
- [ADR-0002：Stream Model](./architecture/adr/0002-stream-model.md)
- [ADR-0003：Repository Boundary](./architecture/adr/0003-repository-boundary.md)
- [ADR-0004：Import Pipeline](./architecture/adr/0004-import-pipeline.md)
- [ADR-0005：Analysis Versioning](./architecture/adr/0005-analysis-versioning.md)
- [ADR-0006：Source Provenance](./architecture/adr/0006-source-provenance.md)

### 测试

- [测试策略](./testing/test-strategy.md)
- [Fixture Policy](./testing/fixture-policy.md)
- [回归矩阵](./testing/regression-matrix.md)

### 迁移

- [Legacy Cache Rescue](./migrations/legacy-cache-rescue.md)
- [IndexedDB v2](./migrations/indexeddb-v2.md)
- [回滚计划](./migrations/rollback-plan.md)

### 执行任务

- [Task Brief 规则和模板](./tasks/README.md)
- [TASK-0000：V2 文档与治理基线](./tasks/0000-v2-documentation-baseline.md)
- [PR-00：Repository Safety](./tasks/pr-00-repository-safety.md)

### 基线证据

- [基线资料规则](./baseline/README.md)
- [V1 基线摘要](./baseline/baseline-summary.md)

## 4. 文档状态

| 状态 | 含义 |
| --- | --- |
| `Proposed` | 尚未正式确认，不得作为已冻结实现强制执行 |
| `Accepted` | 已确认的决策；变更需要新 ADR 或正式修订 |
| `Active` | 当前有效并持续维护的规则或计划 |
| `Deprecated` | 仍保留供参考，但不再指导新开发 |
| `Superseded` | 已被另一份明确链接的文档替代 |
| `Completed` | 任务已经交付并附有完成证据 |

当前六份 ADR 均为 `Proposed`，计划在 PR-02 Canonical Contracts 中结合可执行 Contract 和测试进行确认。

## 5. 当前基线事实

- 当前稳定代码基线：`8b16ebe1a706f1713602ab5266e47000caf31a17`；
- 当前应用仍以 Strava API 和 Legacy Cache 为主要数据路径；
- Legacy IndexedDB：`strava-dashboard-cache`，数据库版本 `1`；
- 当前只有 `npm run check:syntax`，尚无 `npm test` 和 CI；
- V2 正式代码开发必须先完成 PR-00 Repository Safety；
- 在旧缓存可导出和验证之前，不得启动 IndexedDB v2 数据迁移。

## 6. 文档维护规则

- PRD 维护产品目标、范围和验收，不记录逐文件实现步骤；
- Architecture Overview 说明组件关系，不复制完整 schema；
- ADR 记录“为什么这样决定”，接受后不就地改写历史；
- Development Plan 维护 PR 顺序和依赖；
- Task Brief 只描述一个 PR，通常在开工前创建；
- Release Gates 记录可验证门禁，不把计划中的检查伪装成已通过；
- Migration 文档必须随数据库或数据生命周期修改同步更新；
- 每个重要结论应链接到 PR、测试或验证证据。

## 7. 现有 V1 资料

以下根目录文档描述当前实现，暂时作为 V1 参考：

- [`README.md`](../README.md)
- [`TECHNICAL_GUIDE.md`](../TECHNICAL_GUIDE.md)
- [`LOCAL_SETUP.md`](../LOCAL_SETUP.md)

若它们与本目录的 V2 目标冲突，应理解为“当前实现”与“目标架构”的差异，而不是自动覆盖 V2 决策。
