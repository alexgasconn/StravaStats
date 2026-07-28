# ADR-0006：来源身份、Provenance 与合并边界

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 / PR-19 |
| Related ADRs | [ADR-0001](./0001-canonical-activity.md)、[ADR-0004](./0004-import-pipeline.md) |

## Context

同一次运动可能同时来自 Garmin FIT、Strava API、Strava Archive 和用户导入。直接把每个来源变成独立活动会产生重复；直接覆盖又会丢失来源、用户修正和更完整 streams。

V2.0 必须解决活动级身份和精确重复，但完整字段级来源选择属于后续增强。

## Decision

### P0：活动级和来源级 provenance

每个 `ActivitySource` 保存：

```text
id
activityId
provider
externalId
rawArtifactId
acquisitionMethod
deviceId
importedAt
```

每个 RawArtifact 保存 SHA-256、媒体类型、大小和获取方式。Canonical Activity 可以关联多个来源，但来源记录不可被合并操作删除。

### P0：自动精确身份

以下条件可以自动关联：

1. 相同 provider + external ID；
2. 相同 RawArtifact SHA-256；
3. 相同且可信的 FIT session/file identity；
4. 已存在的明确 Source Reference。

### P0：禁止模糊自动合并

以下条件只能创建 `review_required`：

- 开始时间接近；
- 距离或时长相似；
- 文件名相似；
- 路线形状近似；
- 来源之间存在高置信但非精确推断。

用户必须可以选择 same activity、keep separate 或 reject candidate，决策保存审计记录。

### UserOverride

名称、运动类型、装备等用户修改保存在 `UserOverride`，不写回 RawArtifact 或来源原始值。

### P1：字段级 provenance

完整的字段级来源选择、可撤销 merge/unmerge、逐字段优先级属于 P1。V2.0 可以为未来能力保留结构，但不得把未实现的字段级 provenance 作为 P0 已完成能力。

## Default preference guidance

以下只是建议，具体优先级必须可审计并在 P1 冻结：

1.用户明确 override；
2.原始设备文件的 streams/laps/events；
3.平台上的用户编辑名称、描述和装备；
4.低保真 TCX/GPX 或摘要补充。

系统不得因默认优先级删除未选中的来源。

## Consequences

### Positive

- 重复活动有明确身份路径；
- 保留所有原始来源；
- 用户修改与原始事实分离；
- 模糊情况不会静默误合并；
- 为未来字段级合并留出空间。

### Negative

- 同一活动需要维护多个来源关系；
- Merge Candidate 和审计记录增加 UI/存储复杂度；
- 不同平台的 external ID 稳定性需验证；
- 字段级选择不能在 V2.0 自动完整解决。

## Alternatives considered

### 开始时间 + 距离自动合并

拒绝。室内活动、重复训练和时区偏差会造成误合并。

### 导入重复时直接跳过后来的文件

拒绝。后来的 FIT 可能包含更完整 streams 和 laps。

### 合并后删除次要来源

拒绝。破坏审计、重新解析和 unmerge 能力。

## Validation

- 相同 hash 重复导入不产生第二活动；
- 同一 external ID 能幂等更新来源；
- 模糊匹配只能进入人工审查；
- 用户 override 不覆盖 RawArtifact；
- merge decision 可追踪；
- 删除/断开 Connector 不删除已导入 Canonical Activity。
