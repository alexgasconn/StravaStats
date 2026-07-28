# ADR-0001：来源中立的 Canonical Activity

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 Canonical Contracts |
| Related documents | [PRD](../../product/stravastats-v2-prd.md)、[Architecture Overview](../overview.md) |

## Context

当前页面、缓存和分析大量使用 Strava SummaryActivity、DetailedActivity 和 StreamSet 的字段命名。继续让 FIT、TCX、GPX、Strava Archive、Demo 和未来厂商 Connector 直接生成 Strava DTO，会把系统永久绑定在 Strava 的字段、ID、缺失值和运动类型语义上。

V2 需要一个来源中立、可校验、可版本化的领域模型，同时通过临时 Legacy Projection 复用现有 UI。

## Decision

1. 建立 `CanonicalActivity` 作为活动摘要和核心领域身份；
2. 活动 ID 是应用生成的 opaque string，调用方不得解析或假设数值；
3. 内部单位统一为：
   -距离：米；
   -时长：秒；
   -功率：瓦；
   -心率：bpm；
   -海拔：米；
   -温度：摄氏度；
4.绝对时间使用 UTC，另外保存 timezone 或 local offset；
5.缺失值保持 `null` 或 absent，不得转换为 `0`；
6.来源关系保存在 `ActivitySource`，不把 provider 作为页面业务分支；
7.页面根据 `capabilities` 判断 GPS、心率、功率、踏频和 laps 是否可用；
8. Streams、laps、events、devices、overrides 和 analysis 与 Activity Summary 分开；
9.用户修改通过 `UserOverride` 保存，不覆盖原始来源记录；
10.使用 `schemaVersion` 标识 Canonical Contract 版本；
11.迁移期由 Legacy Projection 将 Canonical 数据映射为现有页面字段。

## Initial contract shape

```js
{
  id: 'opaque-string',
  schemaVersion: 1,
  sportCategory: 'run',
  sportVariant: null,
  startTimeUtc: '2026-07-28T06:00:00.000Z',
  timezone: 'Asia/Shanghai',
  distanceMeters: 10000,
  movingTimeSeconds: 3000,
  elapsedTimeSeconds: 3150,
  elevationGainMeters: 80,
  averageHeartRateBpm: null,
  averagePowerWatts: null,
  capabilities: {
    hasGps: true,
    hasHeartRate: false,
    hasPower: false,
    hasCadence: false,
    hasLaps: true
  }
}
```

该示例表达语义，不替代 PR-02 中的 runtime schema。

## Consequences

### Positive

- 新数据源不需要伪装成 Strava；
- 页面与来源解耦；
- 缺失能力可以一致降级；
- 可按 schema 版本迁移和验证；
- Legacy Projection 降低一次性重写风险。

### Negative

- 需要维护 Canonical/Legacy 映射；
- 运动类型和时间语义必须正式冻结；
- Shadow 阶段需要额外存储和 Parity 测试；
- 旧代码中对 numeric Strava ID 的假设需要逐步移除。

## Alternatives considered

### 继续使用 Strava DTO 作为标准模型

拒绝。实现短期最快，但会让所有数据源受 Strava 字段限制。

### 每个数据源直接生成页面 View Model

拒绝。会重复解析、单位转换和缺失值规则，也无法建立统一存储和分析。

### 一次性把全部页面改为全新模型

拒绝。范围过大，无法区分模型、页面和分析回归。

## Open questions

PR-02 必须冻结：

- 完整 sport taxonomy；
- 时间精度和 timezone 表达；
- 扩展字段命名规则；
- runtime schema validator 选型；
- 向后兼容和 schema evolution 规则。

在这些问题确认前，本 ADR 保持 `Proposed`。

## Validation

- Runtime schema 能拒绝非法单位、非法时间和 numeric-only ID 假设；
- 缺失 HR/Power/GPS 的活动可以通过校验；
- Canonical → Legacy Projection 产生与当前页面兼容的字段；
- 不同来源的等价活动可以映射到同一 Contract；
- 测试确认缺失值不会变成 `0`。
