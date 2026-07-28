# Git 与 Worktree 工作流

| 字段 | 内容 |
| --- | --- |
| Status | Active |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related plan | [V2 Development Plan](./v2-development-plan.md) |

## 1. 目标

本工作流用于同时满足三个目标：

1. `main` 始终保持可运行、可发布；
2. V1 可以独立接收必要维护；
3. V2 通过隔离 worktree 和小型 PR 渐进集成，任何阶段均可定位和回退。

Worktree 只是分支的另一个检出目录，不是第二套分支系统。

## 2. Remote 规则

```text
origin    → XiChuan9/StravaStats，个人维护仓库
upstream  → alexgasconn/StravaStats，原作者仓库
```

`upstream` 只允许 fetch，不应作为 push 目标。推荐本地配置：

```bash
git config remote.pushDefault origin
git config push.default simple
git remote set-url --push upstream DISABLED
```

所有 GitHub CLI 操作必须显式指定：

```text
- -repo XiChuan9/StravaStats
```

## 3. 长期分支

```text
main
├── maintenance/v1
└── integration/v2
```

| 分支 | 职责 | 允许变更 |
| --- | --- | --- |
| `main` | 当前稳定生产版本 | 已通过 Release Gate 的发布和 Hotfix |
| `maintenance/v1` | V1 维护 | 严重 Bug、安全、数据救援、必要 Strava 兼容 |
| `integration/v2` | V2 临时集成 | 已审查、已测试的 V2 功能 PR |

长期分支不使用 `codex/` 前缀。V2 正式发布后，`integration/v2` 可以删除，不建立永久 `develop`。

## 4. 功能分支

功能分支统一使用：

```text
codex/v2/<task-name>
```

例如：

```text
codex/v2/repo-safety
codex/v2/legacy-rescue
codex/v2/contracts
codex/v2/repository
codex/v2/storage
codex/v2/decoder-fit
```

每个分支只对应一个 Task Brief 和一个主要架构问题。禁止在同一 PR 中同时修改数据模型、数据来源、分析算法和页面视觉。

## 5. Worktree 目录

长期 worktree：

```text
/Users/wangchuanliang/Documents/StravaStats
    → main

/Users/wangchuanliang/Documents/StravaStats-worktrees/v1
    → maintenance/v1

/Users/wangchuanliang/Documents/StravaStats-worktrees/v2
    → integration/v2
```

短期功能 worktree：

```text
/Users/wangchuanliang/Documents/StravaStats-worktrees/<task-name>
    → codex/v2/<task-name>
```

长期 worktree 可以锁定；功能 worktree 在 PR 合并后删除。

## 6. Codex Worktree 使用方式

普通、短期、依赖较少的 PR 可以使用 Codex App 内置隔离 worktree。

以下任务优先使用手工 worktree：

- FIT、TCX、GPX Decoder；
- 需要固定端口的浏览器验证；
- 需要仓库外私有 fixture；
- 需要跨多次会话保留环境；
- IndexedDB、Service Worker 和大批量导入验证。

同一任务只能选择一种方式，不能同时让 Codex App 内置 worktree和手工 worktree修改同一分支。

## 7. 两段式任务流程

每个 PR 必须按以下顺序工作：

```text
Task Brief
→ 只读调查
→ 项目负责人确认范围和待决事项
→ 正式实施
→ 自动测试
→ 独立审查线程
→ 人工验收
→ 合并 PR
→ 清理 worktree
```

### 7.1 只读调查

调查阶段不得修改文件或 Git 状态。输出必须包含：

- 当前状态审计；
- P0/P1/P2 风险；
- 最小修改文件集合；
- 隐藏依赖；
- 自动测试和人工验证方案；
- 数据与回滚影响；
- 需要负责人确认的决定。

### 7.2 正式实施

实施前必须确认：

- 当前分支与 Task Brief 一致；
- 当前 worktree 干净；
- 依赖 PR 已合并；
- 所需 ADR 已接受或明确仍为 Proposed；
- 允许修改和禁止修改的文件已经列出。

## 8. PR 与合并策略

| 来源 | 目标 | 策略 |
| --- | --- | --- |
| `codex/v2/*` | `integration/v2` | Squash Merge |
| `integration/v2` Release | `main` | Merge Commit |
| `codex/hotfix/*` | `main` | Merge Commit |
| `codex/upstream-sync/*` | `main` | 独立 PR |

Hotfix 合入 `main` 后必须同步到仍然活跃的 `integration/v2`。已开始评审或已被其他 worktree 使用的共享分支不得 rebase 或 force-push。

## 9. 热点文件所有权

以下文件或领域同一时间只能有一个修改者：

| 文件或领域 | 规则 |
| --- | --- |
| `package.json` / `package-lock.json` | 单一 Owner |
| `js/app/main.js` | 单一 Owner |
| `js/app/auth.js` | 单一 Owner |
| `js/tabs/run-plus.js` | 单一 Owner |
| `styles/run-plus.css` | 单一 Owner |
| `sw.js` | 单一 Owner |
| Decoder Registry | 单一 Owner |
| IndexedDB Schema/Migration | 单一 Owner |

如并行任务都需要热点文件，应调整 PR 顺序，而不是让多个 Agent 之后手工合并冲突。

## 10. Upstream 同步

不要在 V2 功能分支中直接 merge `upstream/main`。流程如下：

1. `git fetch upstream`；
2. 检查自上次审阅以来的提交和 diff；
3. 从 `main` 创建 `codex/upstream-sync/<date>`；
4. 选择完整 merge、`cherry-pick -x` 或按新架构重新实现；
5. 通过独立 PR 合入 `main`；
6. 再从 `main` 同步到 `integration/v2`。

重新实现上游修复时，提交信息应记录原 upstream commit。

## 11. 禁止操作

- 不直接向 `main`、`maintenance/v1`、`integration/v2` 推送功能代码；
- 不在任务 worktree 中切换到其他分支；
- 不使用 `git add .`；
- 不提交真实 FIT、TCX、GPX、Strava ZIP、GPS、心率或功率数据；
- 不修改任务范围外的热点文件；
- 不 amend 或改写共享提交；
- Agent 不自行合并 PR；
- 未确认任务结束前不删除 Codex worktree；
- 未完成备份和验证前不删除 Legacy Cache 或 IndexedDB v2。

## 12. 提交与推送

使用 Conventional Commits：

```text
docs(v2): establish governance baseline
test(repo): add deterministic repository contract tests
feat(storage): initialize versioned activity database
refactor(provider): route summaries through repository
fix(migration): preserve legacy cache during disconnect
```

提交前必须显式暂存允许的路径，并检查：

```bash
git status --short
git diff --check
git diff --cached --stat
git diff --cached
```

## 13. Worktree 清理

PR 合并后：

1. 确认 worktree 无未提交修改；
2. 确认提交已进入目标分支；
3. 删除功能 worktree；
4. 删除本地功能分支；
5. 删除远端功能分支；
6. 执行 `git worktree prune`；
7. 保留 Task Brief 和 PR 证据。

任何不确定是否仍被 Codex 任务使用的 worktree 都不得删除。
