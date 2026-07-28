# TASK-0000：V2 文档与治理基线

## Metadata

| 字段 | 内容 |
| --- | --- |
| Status | In review |
| Base branch | `main` |
| Feature branch | `codex/docs/v2-governance-baseline` |
| Worktree | `/Users/wangchuanliang/Documents/StravaStats` |
| Owner | XiChuan9 |
| Reviewer | 待指定 |
| Related PRD | [StravaStats v2 PRD](../product/stravastats-v2-prd.md) |
| Related plan | [V2 Development Plan](../engineering/v2-development-plan.md) |
| Data migration | None |
| Runtime behavior | No change |
| Pull request | Not created |

## 1. Goal

在 V2 代码开发开始前，把产品、工程、架构、测试、迁移和 PR 执行规则写入仓库，建立可审查的长期事实来源。

## 2. Why now

当前关键决定主要存在于历史对话和两份大型规划文档中。若直接开始开发，Agent 会自行补全未冻结的架构、任务拆分会与最新开发计划偏离，测试和回滚会落后于数据代码。

本任务先建立治理基线，不引入任何运行时代码。

## 3. Confirmed current-state facts

- 稳定代码基线是 `8b16ebe1a706f1713602ab5266e47000caf31a17`；
- 当前主要数据源仍是 Strava API；
- Legacy DB 是 `strava-dashboard-cache`，版本 `1`；
- 页面中仍有直接 `/api/strava-*` 请求；
- `package.json` 尚无 `npm test`；
- 尚无 GitHub Actions CI；
- 当前 logout/disconnect 会清除活动缓存；
- 当前工作分支是 `codex/docs/v2-governance-baseline`；
- 本任务创建的 `docs/` 尚未进入稳定分支。

## 4. In scope

- 产品 PRD；
- 完整工程开发计划；
- 文档入口和事实优先级；
- Git/worktree/PR/Codex 两段式工作流；
- 可验证的 Release Gates；
- V2 架构总览；
- 六份 Proposed ADR；
- 测试策略、fixture policy、回归矩阵；
- Legacy Rescue、IndexedDB v2 和 rollback 文档；
- 仓库安全的 baseline evidence 规则；
- Task Brief 模板；
- 下一步 PR-00 Repository Safety 任务包；
- 根 README 的 V2 文档入口。

## 5. Out of scope

- 不创建 `AGENTS.md`；
- 不修改 `.gitignore`；
- 不增加 `npm test` 或依赖；
- 不增加 GitHub Actions；
- 不实现 Feature Flag；
- 不修改 Service Worker；
- 不创建 Canonical Contract；
- 不创建 IndexedDB v2；
- 不实现 Repository、Import 或 Decoder；
- 不修改认证、页面、分析或 CSS；
- 不创建 `maintenance/v1`、`integration/v2` 或 baseline tag；
- 不提交真实基线截图或运动数据。

以上内容由 PR-00 或后续对应 PR 实施。

## 6. Allowed files

```text
README.md
docs/**
```

## 7. Prohibited files and operations

```text
api/**
js/**
styles/**
sw.js
package.json
package-lock.json
.gitignore
.github/**
AGENTS.md
```

禁止：

- `git add .`；
- 提交真实 FIT/TCX/GPX/ZIP；
- 提交私人 GPS、心率、功率或截图；
- 把 Proposed ADR 标记为 Accepted；
- 创建或切换其他分支；
- 创建 V2 数据库；
- 声称不存在的测试或 CI 已通过。

## 8. Deliverables

```text
docs/README.md
docs/product/stravastats-v2-prd.md
docs/engineering/v2-development-plan.md
docs/engineering/git-worktree-workflow.md
docs/engineering/release-gates.md
docs/architecture/overview.md
docs/architecture/adr/0001-0006
docs/testing/*
docs/migrations/*
docs/baseline/*
docs/tasks/README.md
docs/tasks/0000-v2-documentation-baseline.md
docs/tasks/pr-00-repository-safety.md
README.md documentation map
```

## 9. Acceptance criteria

- [ ]所有长期文档非空；
- [ ]文档之间没有 branch naming 冲突；
- [ ]统一使用 `main`、`maintenance/v1`、`integration/v2`、`codex/v2/*`；
- [ ]统一使用 ADR-0001～ADR-0006；
- [ ]旧版 12-task 空文件不再存在；
- [ ]任务体系与最新 PR-00～PR-24 开发计划一致；
- [ ]只完整创建当前 TASK-0000 和下一步 PR-00；
- [ ]六份 ADR 均为 Proposed；
- [ ]未冻结的 Stream 底层表示明确为待决；
- [ ]字段级 provenance 明确属于 P1；
- [ ] Release Gate 区分 Not implemented 与 Pass；
- [ ]真实基线证据规则符合隐私要求；
- [ ] README 包含 V2 Documentation Map；
- [ ]没有运行时代码变更；
- [ ]没有真实数据或凭据。

## 10. Required checks

```bash
find docs -type f -empty
rg -n 'ADR-00[1-6][^0-9]' docs
git diff --check
npm run check:syntax
git status --short
```

另外人工搜索并排除旧分支命名，检查 Markdown 链接和每个目标文件是否存在。

当前没有 `npm test`，不得把它列为已通过。

## 11. Manual verification

- Documentation Map 链接可解析；
- PRD、Development Plan 与 ADR 的 P0/P1 边界一致；
- Git workflow 与最新分支计划一致；
- Release Gates 没有虚假 Pass；
- Task Brief 模板可以直接用于 PR-00；
- 根目录 V1 文档仍然可访问。

## 12. Privacy and security impact

本任务不处理真实活动。任何真实截图、活动数量、GPS、HR、Power、Token 和导出文件都不得进入 Git。

`baseline-summary.md` 只保存非识别性摘要，私有证据放在仓库外。

## 13. Migration impact

无数据库或用户数据变更。本任务只定义未来 migration 规则。

## 14. Rollback

Revert 本文档 PR 即可。回滚不会影响运行时代码、浏览器缓存或用户数据。

## 15. Independent review checklist

- [ ]没有把历史对话当作唯一事实来源；
- [ ]没有重复粘贴整份 PRD 到子文档；
- [ ] Proposed/Accepted 使用正确；
- [ ]任务命名与 Development Plan 一致；
- [ ]所有数据安全不变量有正式落点；
- [ ]未授权的代码和配置没有修改；
- [ ]无个人数据。

## 16. Completion evidence

合并前填写：

```text
Commit SHA:
Pull request:
Checks:
Reviewer:
Merged at:
Follow-up PR: PR-00 Repository Safety
```
