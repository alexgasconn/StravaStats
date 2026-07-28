# ADR-0005：分析结果版本化与失效

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 / Analysis v2 |
| Related ADRs | [ADR-0001](./0001-canonical-activity.md)、[ADR-0002](./0002-stream-model.md) |

## Context

原始文件只应解析一次，但分析结果不能被视为永久有效。Parser 修复、运动类型修正、FTP/最大心率/区间变化、Streams 补充和算法升级都可能要求重新计算。如果只使用一个全局 cache version，将无法判断具体哪些活动和分析结果失效。

## Decision

分析与数据版本分开记录：

```text
schemaVersion
parserVersion
normalizerVersion
analysisVersion
settingsVersion
inputHash
```

每个 `AnalysisSnapshot` 至少包含：

```text
activityId
analysisType
inputHash
algorithmVersion
status
createdAt
result
error/warnings
```

状态：

```text
missing
queued
running
valid
stale
failed
```

### Stale 触发条件

- Activity 或 Streams 更新；
- Parser/Normalizer 版本变化；
- 运动类型被修正；
- FTP、最大心率、zones 或相关设置变化；
- Analysis Algorithm 版本变化；
- 新增历史活动影响 CTL/ATL/TSB 等时间线结果；
- 来源合并改变了被选用的输入。

### 读取规则

- Repository/Analysis Service 优先返回 `valid` snapshot；
- 版本或 input hash 不一致时标记 `stale`；
- stale 可以暂时展示，但 UI 必须明确标识；
- 重算失败不得删除最后一个可解释结果；
- 旧 snapshot 保留到清理策略明确执行。

### PR 边界

数据来源迁移、Repository 切换和分析算法改动不得放在同一 PR。算法变化需要自己的版本、测试和回归说明。

## Consequences

### Positive

- 只重算受影响的数据；
- 结果可以追踪和复现；
- 算法升级与数据迁移解耦；
- 失败后仍保留最后已知结果；
- 支持比较新旧算法。

### Negative

- 需要 input hash、依赖图和清理策略；
- 时间线分析可能需要批量失效；
- 存储多个 snapshot 增加容量；
- 设置变更影响范围必须明确定义。

## Alternatives considered

### 每次页面打开全部重算

拒绝。性能差、不可复现、页面逻辑复杂。

### 只有单一全局 CACHE_VERSION

拒绝。会造成过度失效或错误复用。

### 算法升级时删除旧结果

拒绝。无法比较、诊断和回退。

## Open questions

- input hash 的规范序列化格式；
- 时间线指标依赖范围；
- stale 结果的 UI 表达；
- snapshot 保留与容量清理策略；
- 哪些设置进入 settingsVersion。

## Validation

- 相同输入和版本复用 snapshot；
- 改变 FTP 只失效依赖 FTP 的分析；
- 补充 HR stream 会使相关分析 stale；
- 新增历史活动会失效受影响的时间线；
- 重算失败时旧结果仍可查看且标记状态。
