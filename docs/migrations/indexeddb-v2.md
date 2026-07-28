# IndexedDB v2 设计与迁移规则

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Target implementation | PR-05 IndexedDB v2 Schema |
| Related ADRs | ADR-0001、ADR-0002、ADR-0005、ADR-0006 |

## 1. 核心决定

V2 使用独立数据库：

```text
strava-stats-v2
```

不得原地升级、重命名、覆盖或删除：

```text
strava-dashboard-cache
```

Legacy 数据库在 V2 稳定、回滚演练和用户备份完成前保持可读。

## 2. Proposed object stores

```text
rawArtifacts
importJobs
importItems
activities
activitySources
streamSeries
laps
events
devices
userOverrides
analysisSnapshots
timelineSnapshots
mergeCandidates
mergeDecisions
sourceConnections
settings
migrations
```

具体 keyPath、index 和数据表示在 ADR/Contract 接受后冻结。

## 3. Proposed indexes

```text
activities.startTimeUtc
activities.sportCategory
activitySources.[provider, externalId]
rawArtifacts.sha256
importJobs.createdAt
importItems.jobId
streamSeries.[activityId, streamType]
analysisSnapshots.[activityId, analysisType, inputHash]
mergeCandidates.status
migrations.version
```

每个 index 必须对应明确查询；禁止为了“以后可能有用”无限增加写入成本。

## 4. Key 和 ID 规则

- 所有应用级 ID 是 opaque string；
- 调用方不得依赖自增数字或解析 ID；
- 来源 external ID 与内部 ID 分离；
- RawArtifact 通过稳定 ID 和 SHA-256 查找；
- 复合 index 不替代实体主键；
- backup/restore 保持内部引用一致。

## 5. Transaction boundaries

以下写入必须原子：

### 单个导入活动

```text
activity
activitySources
streamSeries
laps
events
devices relation
importItem status
```

### Merge decision

```text
mergeCandidate status
mergeDecision
activity source relations
affected analysis invalidation
```

### Restore unit

恢复策略必须明确是整库 staging 后切换，还是按批次事务；失败不得覆盖现有可用资料库。

一个 ImportItem 失败不回滚其他已经完成的 Item。

## 6. Schema versioning

数据库版本与 Canonical schema、parser 和 analysis version 分开：

```text
indexedDbVersion
canonicalSchemaVersion
parserVersion
normalizerVersion
analysisVersion
backupFormatVersion
```

IndexedDB `version` 只表示物理 schema 升级，不用于表示算法变化。

## 7. Migration registry

`migrations` store 至少记录：

```text
id
fromVersion
toVersion
status
startedAt
completedAt
applicationVersion
inputSummary
outputSummary
errorCode
retryCount
```

状态：

```text
pending
running
completed
failed
rolled_back
```

Migration 必须幂等。重复初始化或重试不会创建重复数据。

## 8. Initialization

空库初始化必须：

1.打开指定版本；
2.创建必需 stores/indexes；
3.写入数据库 metadata；
4.写入初始 migration 记录；
5.关闭并重新打开验证；
6.不访问或修改 Legacy DB。

初始化失败时应用可回退 Legacy，不自动重试无限循环。

## 9. Upgrade rules

- 升级前确认浏览器存储能力；
- 必要时要求用户创建备份；
- `onupgradeneeded` 只做短小、可预测的结构操作；
- 大规模数据转换使用显式 migration job，不阻塞版本升级事务；
- migration 记录进度和失败；
- 不在读取页面时偷偷执行不可逆转换；
- 不允许 silent data loss；
- 旧字段清理必须是后续独立 migration。

## 10. Streams 和大对象

在 ADR-0002 未冻结前，Stream 的 Array/TypedArray/Blob/chunk 表示保持 Proposed。

必须满足：

- 启动不加载所有 streams；
- 按 activity + requested type 查询；
- 200,000 点活动可存储、读取和降采样；
- normalized 数据与 chart cache 分离；
- backup 可以流式处理，避免一次构建巨大 JSON；
- quota error 不产生半条活动。

## 11. Concurrency

必须测试：

- 多个 tab 同时打开；
- import worker 与页面读取并发；
- 数据库版本升级时已有连接；
- migration 与新导入冲突；
- 用户取消导入；
- 浏览器关闭/崩溃。

需要明确数据库连接关闭策略和 `versionchange` 处理。

## 12. Quota 和容量

使用 Storage Estimate 提供容量信息。空间不足时：

- 在写入前尽可能预估；
- 当前事务失败并回滚；
- ImportItem 标记 `failed_storage`；
- 提示备份或显式清理；
- 不自动删除 raw、streams、analysis 或 Legacy 数据。

任何自动清理策略必须有独立 ADR。

## 13. Backup compatibility

备份 manifest 至少记录：

```text
backupFormatVersion
indexedDbVersion
canonicalSchemaVersion
createdAt
applicationVersion
stores/files
record counts
hashes
```

恢复前在 staging 结构校验，版本不兼容时不得强制覆盖当前资料库。

## 14. Test requirements

PR-05 至少覆盖：

- 空库初始化；
- 重复初始化；
- schema upgrade；
- 中断和重试；
- transaction rollback；
- quota error；
- 多连接/versionchange；
- 数据计数和索引查询；
- Legacy DB 未改变；
- Feature Flag 回退。

## 15. Acceptance criteria

- [ ]数据库名与 Legacy 分离；
- [ ] object stores 和 indexes 有 Contract；
- [ ]所有 migration 幂等；
- [ ]失败不会留下半个活动；
- [ ]重复初始化安全；
- [ ] Legacy DB 不被打开为 readwrite；
- [ ] quota、并发和中断有测试；
- [ ] backup metadata 可以描述当前 schema；
- [ ]数据库错误可诊断且不泄露隐私；
- [ ]页面尚未被强制切换到 Canonical。
