# ADR-0003：Repository 是消费者唯一数据边界

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Date | 2026-07-28 |
| Decision owners | XiChuan9 |
| Target decision PR | PR-02 / PR-03 |
| Related ADRs | [ADR-0001](./0001-canonical-activity.md)、[ADR-0002](./0002-stream-model.md) |

## Context

当前 `js/services/api.js`、Activity Detail、Run、Bike、Swim、Advanced Analysis 和 Run Plus 中仍存在直接 `/api/strava-*` 请求。只增加文件解析器而不收口这些调用，会让本地数据无法复用现有页面，并导致每个页面自行处理来源差异。

## Decision

1. UI、tab、详情页和分析入口只通过 Repository 或明确的 read projection 读取活动数据；
2.页面不得直接：
   -调用第三方 API；
   -调用 `/api/strava-*`；
   -打开具体 IndexedDB store；
   -读取原始 FIT/TCX/GPX；
3.定义最小 Repository Contract：

```text
listActivities / listSummaries
getActivity / getSummary
getDetail
getActivityBundle
getStreams
getLaps
getAthlete
getZones
getGears
count
```

4. Legacy Repository 封装当前 Strava API 和 Legacy Cache；
5. Canonical Repository 读取 IndexedDB v2；
6. Repository Factory 根据 `dataRepositoryMode` 选择 legacy/shadow/canonical；
7. Shadow Mode 页面仍读取 Legacy，Canonical 仅双写和比较；
8.一个详情页只获取一次 `ActivityBundle`，Advanced Analysis 复用同一数据；
9. Legacy Projection 是 Consumer 迁移期的兼容层；
10.认证属于 Connector 生命周期，不是 Repository 本地读取的前置条件。

## Consequences

### Positive

- 现有页面可复用多数据源；
- 网络、缓存和 IndexedDB 实现细节集中；
- 可用 Contract Tests 比较 Legacy/Canonical 返回；
- Feature Flag 可以回退；
- 避免 Demo 和 provider 判断散落页面。

### Negative

- 初期增加 Adapter、Factory 和 Projection；
- 消费者迁移会触及多个热点文件；
- 接口过宽会形成新的 God Object，需要按 Summary/Detail/Streams 分层；
- Legacy 返回差异必须显式记录。

## Alternatives considered

### 页面继续直接 fetch，本地模式再加 if/else

拒绝。会快速产生 provider 分支和重复错误处理。

### 页面直接读取 IndexedDB

拒绝。会把 schema、事务和 migration 泄漏到 UI。

### 一次性删除 Legacy 路径

拒绝。失去 Shadow 比较和紧急回退。

## Enforcement

Consumer Migration 完成标准：

```bash
rg -n -F '/api/strava-' js/pages js/tabs
```

除 Connector/Provider 和认证边界外，消费者目录不得再有直接 Strava API 调用。

后续可以增加静态检查，阻止新的直接调用进入页面。

## Validation

- Legacy Repository Contract 测试与当前 API 结果等价；
- Demo、Legacy、Canonical 使用同一 consumer interface；
- 无 Token 时 Canonical Repository 可工作；
- 详情页没有重复请求；
- Feature Flag 切换不要求页面改代码。
