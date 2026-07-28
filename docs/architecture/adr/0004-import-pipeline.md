# ADR-0004：来源中立、事务化的 Import Pipeline

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 / PR-07 |
| Related ADRs | [ADR-0001](./0001-canonical-activity.md)、[ADR-0006](./0006-source-provenance.md) |

## Context

本地文件、Strava Archive、Strava API 和 Demo 会提供不同容器和格式。若每个来源自行解析、去重、写库和触发分析，将重复实现安全、事务和幂等逻辑。

## Decision

所有来源进入统一流水线：

```text
validate
→ hash
→ decode
→ normalize
→ exact identity
→ transactional persist
→ analysis enqueue
→ import report
```

### Connector 与 Decoder 分离

- Connector 负责获取、认证、分页和增量同步；
- Decoder 负责解释 FIT/TCX/GPX/CSV/JSON；
- 多个 Connector 可以复用同一个 Decoder；
- Decoder 只输出 `ImportedActivityBundle`。

### RawArtifact

- 原始文件或 API payload 有稳定 ID、SHA-256、媒体类型、大小和获取方式；
- RawArtifact 不可变；
- 真实文件是否保存在库中由导入/隐私设置决定，但 identity 元数据必须可审计。

### Job 与 Item

- 一次批量操作是 `ImportJob`；
- 单个文件或活动是 `ImportItem`；
- Job 记录总数、完成数、状态和错误摘要；
- Item 记录 artifact、状态、activityId、warning/error code。

### 事务语义

- 单个活动的 activity/source/streams/laps/events 写入必须在一致事务中完成；
- 单个 Item 失败不回滚同批已成功项目；
- 失败 Item 可重试；
- 重复执行不会生成第二条 Canonical Activity；
- Worker 崩溃或页面关闭后，已提交数据保留，未完成 Item 可识别。

### 安全

- 大文件解析放入 Worker；
- XML 禁止外部实体；
- ZIP 防止 path traversal、zip bomb、文件数量和总解压大小超限；
- 导入文本进入 DOM 前必须转义；
- 失败日志不包含完整文件内容、GPS 或健康流。

## Import states

```text
queued
validating
hashing
decoding
normalizing
matching
persisting
analyzing
completed
completed_with_warnings
failed_validation
failed_decode
failed_storage
cancelled
retrying
```

## Consequences

### Positive

- 格式解析只实现一次；
- 安全、状态和事务一致；
- 支持进度、取消、重试和报告；
- Demo 可以测试真实主干；
- 便于加入新 Connector。

### Negative

- 第一条纵向切片前需要较多基础契约；
- Worker、IndexedDB 和取消语义增加复杂度；
- RawArtifact 保存策略影响存储容量；
- Job 恢复需要明确提交边界。

## Alternatives considered

### 每个 Provider 自行导入

拒绝。重复 Decoder、Normalizer、去重和安全逻辑。

### 页面打开时解析原始文件

拒绝。性能不可预测，也无法建立稳定版本和 Repository。

### 整批 all-or-nothing

拒绝。一个损坏文件不应丢弃其他成功活动。

## Validation

- 同一 synthetic fixture 导入十次只产生一条活动或明确来源关联；
- 一个损坏 Item 不影响同批成功 Item；
- 取消和 Worker 崩溃有可恢复状态；
- 写库失败事务回滚；
- Import Report 能区分 success、warning、duplicate、review 和 failed；
- Decoder 测试不依赖 UI、网络或真实资料。
