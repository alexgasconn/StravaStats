# V2 Task Brief 规则与模板

| 字段 | 内容 |
| --- | --- |
| Status | Active |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related workflow | [Git and Worktree Workflow](../engineering/git-worktree-workflow.md) |

## 1. 目的

Task Brief 是一个 PR 的执行合同。它把长期 PRD、开发计划和 ADR 收敛成一个可调查、可实施、可验证、可回滚的小任务。

Task Brief 不是新的产品或架构事实来源，不能静默推翻 Accepted ADR、PRD 或数据安全约束。

## 2. Just-in-time 原则

- 当前 PR 的 Task Brief 必须完整；
- 下一至两个 PR 可以为 Draft；
- 更远任务只保留在 Development Plan；
- 架构或依赖变化后再生成后续 Task Brief；
- 不要一次写满全部 PR，以免产生第二套过期计划。

## 3. 状态

```text
Draft
Ready for investigation
Investigating
Awaiting decision
Approved for implementation
In progress
In review
Merged
Blocked
Superseded
```

`Approved for implementation` 之前不得开始写代码。

## 4. 两道门

### Investigation Gate

只读调查完成后必须确认：

- 当前代码事实；
- 最小修改范围；
- 隐藏依赖和热点文件；
- 自动测试与人工验证；
- 隐私、数据和 migration 影响；
- 所有需要项目负责人确认的问题。

### Implementation Gate

项目负责人批准调查结果，并确认：

- 范围；
- 允许和禁止文件；
- 待决架构处理；
- 测试命令；
- 回滚方式；
- 分支和 worktree。

## 5. 命名

```text
pr-00-repository-safety.md
pr-01-legacy-cache-rescue.md
pr-02-canonical-contracts.md
pr-04a-summary-consumers.md
```

文件名与 Development Plan 的 PR 编号和标题保持一致。当前文档基线不属于 Sprint PR，使用：

```text
0000-v2-documentation-baseline.md
```

## 6. Task Brief 模板

```markdown
# PR-XX: Title

## Metadata

| Field | Value |
| --- | --- |
| Status | Draft |
| Base branch | `integration/v2` |
| Feature branch | `codex/v2/<task>` |
| Worktree | `/Users/.../<task>` |
| Owner | |
| Reviewer | |
| Related PRD | |
| Related ADRs | |
| Dependencies | |
| Pull request | |

## Goal

## Why now

## Investigation questions

## Confirmed current-state facts

## Decisions required before implementation

## In scope

## Out of scope

## Allowed files

## Prohibited files and operations

## Interfaces and expected outputs

## Acceptance criteria

## Required automated checks

## Manual verification

## Privacy and security impact

## Migration impact

## Rollback procedure

## Independent review checklist

## Completion evidence
```

## 7. 范围写法

`In scope` 必须能转换为明确 diff；`Out of scope` 必须阻止常见的“顺便重构”。

允许文件使用具体路径：

```text
package.json
.github/workflows/ci.yml
tests/unit/feature-flags.test.js
```

不要只写：

```text
相关文件
必要代码
```

若实现中发现必须修改未授权文件，应暂停并说明原因，不自动扩大范围。

## 8. 验收写法

验收标准应可观察：

```text
同一 fixture 导入两次后 activities count 不变
```

不要写：

```text
导入功能正常
```

每条验收标准应对应：

- 自动测试；
- 人工验证；或
- 明确证据。

## 9. 最终报告

完成时必须报告：

1. 实现摘要；
2.修改文件；
3.架构决策；
4.测试命令和结果；
5.人工验证；
6.已知限制；
7.数据迁移影响；
8.隐私与安全影响；
9.回滚步骤；
10. commit SHA；
11. PR 地址；
12.剩余风险。

未运行或无法运行的检查必须单独列出，不得与 Pass 混合。

## 10. 当前任务

- [TASK-0000：V2 文档与治理基线](./0000-v2-documentation-baseline.md)
- [PR-00：Repository Safety](./pr-00-repository-safety.md)

PR-01 及以后按 Just-in-time 原则，在依赖任务调查和合并后创建。
