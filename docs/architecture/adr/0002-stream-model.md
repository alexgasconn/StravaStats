# ADR-0002：活动 Stream 模型

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 Canonical Contracts |
| Related ADR | [ADR-0001](./0001-canonical-activity.md) |

## Context

Strava、FIT、TCX 和 GPX 对时间序列的组织方式不同：有的共享统一时间轴，有的每条 series 采样率不同，有的缺少时间、距离或部分传感器值。现有页面倾向直接消费 Strava streams，如果把这种结构直接固定为 V2 标准，会造成数据丢失、全零填充和重复解析。

## Decision

目前冻结以下高层规则：

1. Streams 与 Activity Summary 分开存储和按需加载；
2.每条 `StreamSeries` 必须声明：
   - `activityId`；
   - `streamType`；
   - `unit`；
   -时间或 offset 数据；
   -值数据；
   - coverage/quality 元数据；
3.支持的核心类型包括 time、distance、latlng、altitude、heartrate、cadence、watts、velocity 和 moving；
4.缺失 stream 表示 unavailable，不创建全零数组；
5.单点缺失必须保留缺失语义，不能当作真实 `0`；
6. laps 和 events 是独立领域对象，不隐藏在 stream 数组中；
7. pause/resume/start/stop 等保存为 event；
8.原始 normalized stream 与面向图表的降采样结果分离；
9.图表降采样不得覆盖可重新分析的 normalized 数据；
10. Repository 支持按 activity 和 requested types 读取；
11.大量 streams 不在应用启动时加载。

## Proposed interface

```js
class StreamRepository {
  async getStreams(activityId, requestedTypes) {}
  async hasStream(activityId, streamType) {}
}
```

## Deliberately unresolved

以下决定必须通过样本、性能实验和 Contract 测试后在 PR-02/PR-05 冻结：

- 所有 series 使用统一时间轴，还是允许独立时间轴；
- IndexedDB 中使用普通数组、TypedArray、Blob 或 chunk；
- GPS 的 lat/lng 组合或分离表达；
- 采样空洞、插值和重复 timestamp 的表示；
- 压缩、chunk size 和大 stream 查询策略；
- 没有时间戳的 GPX/TCX 如何表达；
- coverage 和 quality 指标的精确定义。

这些问题未确认前，不应把某种底层表示标记为 `Accepted`。

## Consequences

### Positive

- 支持不同采样率和缺失传感器；
- 避免页面加载全部 streams；
- 保留未来重算和质量分析能力；
- 图表性能优化不会破坏原始 normalized 数据。

### Negative

- 比 Strava 的简单数组结构更复杂；
- 需要明确对齐和 projection 规则；
- 存储格式会影响 IndexedDB 性能和备份格式；
- Decoder 测试矩阵必须覆盖异常时间轴。

## Alternatives considered

### 永久使用 Strava StreamSet

拒绝。无法完整表达多格式采样和来源差异。

### 将所有数据强制插值到统一一秒时间轴

拒绝。会制造不存在的数据，扩大存储，并改变分析结果。

### 只保存页面所需的降采样数据

拒绝。无法支持未来算法、重新分析和精确导出。

## Validation

- 无 GPS/HR/Power 活动可以正常读取能力；
- 暂停、重复 timestamp、不同采样率和 stream 空洞有 fixture；
- 200,000 点活动不在启动阶段加载；
- 降采样结果与 normalized 数据分开；
- projection 能生成当前详情页所需 streams。
