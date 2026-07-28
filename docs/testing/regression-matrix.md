# StravaStats v2 回归矩阵

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related gates | [Release Gates](../engineering/release-gates.md) |

## 1. 使用规则

本矩阵记录必须长期保持的行为场景。当前尚未建立自动测试，因此所有条目初始为 `Planned` 或 `Not implemented`，不能标记为 Pass。

状态：

```text
Not implemented
Planned
Automated
Manual pass
Failed
Blocked
Not applicable
```

每个执行结果应链接测试、CI、Parity Report、截图或人工验证记录。

## 2. 基线消费者矩阵

| ID | Mode/source | Data shape | Consumer | Expected result | Target test | Status |
| --- | --- | --- | --- | --- | --- | --- |
| REG-001 | Legacy Strava | Summary | Dashboard | 当前 KPI、图表和筛选可用 | E2E + parity | Planned |
| REG-002 | Legacy Strava | Summary | Activities | 列表、筛选、排序可用 | E2E + parity | Planned |
| REG-003 | Legacy Strava | Run summary | Run | 汇总图表和活动表可用 | E2E + visual | Planned |
| REG-004 | Legacy Strava | Bike summary | Bike | 汇总图表和活动表可用 | E2E + visual | Planned |
| REG-005 | Legacy Strava | Swim summary | Swim | Pool/open-water 逻辑可用 | E2E + visual | Planned |
| REG-006 | Legacy Strava | Full streams | Activity Detail | 详情、streams、导出可用 | E2E | Planned |
| REG-007 | Legacy Strava | Run + streams | Run Plus | 现有取数和分析结果不变 | E2E + manual | Planned |
| REG-008 | Legacy Strava | History | NSM | 设置、过滤和时间线不变 | E2E + manual | Planned |
| REG-009 | Legacy Strava | Summary/polyline | Map | 路线和筛选可用 | E2E + visual | Planned |
| REG-010 | Legacy Strava | Gear | Gear |装备映射和累计里程可用 | E2E | Planned |

## 3. 模式切换矩阵

| ID | Scenario | Expected result | Target test | Status |
| --- | --- | --- | --- | --- |
| REG-020 | `legacy` 启动 | 只读 Legacy，不要求 V2 数据库有数据 | Integration | Planned |
| REG-021 | `shadow` 启动 | 页面读 Legacy，Canonical 双写 | Integration | Planned |
| REG-022 | Shadow 写入失败 | Legacy 页面继续，错误可诊断 | Fault injection | Planned |
| REG-023 | `canonical` 启动 | 页面读 Canonical Repository | E2E | Planned |
| REG-024 | Canonical 切回 Legacy | 不删除 Canonical 或 Legacy 数据 | E2E + migration | Planned |
| REG-025 | 无 Strava Token + 本地活动 | 直接进入 Dashboard | E2E | Planned |
| REG-026 | 无 Token + 空资料库 | 进入 First-run/Source Manager | E2E | Planned |
| REG-027 | Disconnect Strava | 本地资料库保留 | E2E + storage | Planned |

## 4. 数据格式矩阵

| ID | Source/format | Sport | Capabilities | Expected result | Status |
| --- | --- | --- | --- | --- | --- |
| REG-040 | Synthetic JSON | Run | Summary | 完整纵向切片 | Planned |
| REG-041 | Strava CSV | Run | Summary-only | Dashboard/Activities 可用，详情降级 | Planned |
| REG-042 | Strava CSV | Bike | Summary-only | Bike 汇总可用 | Planned |
| REG-043 | Strava ZIP | Mixed | Summary + linked files | CSV 与原始文件正确关联 | Planned |
| REG-044 | FIT | Run | GPS + HR + Laps | 详情和分析可用 | Planned |
| REG-045 | FIT | Pool Swim | HR + Laps, no GPS | Swim/详情能力降级正确 | Planned |
| REG-046 | FIT | Ride | GPS + HR + Power + Cadence | Bike/详情可用 | Planned |
| REG-047 | FIT | Indoor Run | HR + Cadence, no GPS | Map 隐藏，分析可用 | Planned |
| REG-048 | TCX | Run | GPS + HR + Laps | Canonical mapping 正确 | Planned |
| REG-049 | TCX | Ride | Missing speed | 可从 distance/time 推导或保持缺失 | Planned |
| REG-050 | GPX | Run | GPS + elevation | Summary/route 可用 | Planned |
| REG-051 | GPX | Run | Missing time | 明确 warning，不制造虚假时间 | Planned |

## 5. 缺失能力矩阵

| ID | Missing capability | Expected UI behavior | Expected data behavior | Status |
| --- | --- | --- | --- | --- |
| REG-060 | GPS | Map/route 隐藏或显示解释 | 不生成虚假坐标 | Planned |
| REG-061 | HR | HR 图表和相关指标降级 | 不写 `0` HR | Planned |
| REG-062 | Power | Power 图表降级 | 不写 `0` watts | Planned |
| REG-063 | Cadence | Cadence 图表降级 | capability=false | Planned |
| REG-064 | Laps | Split/Lap UI 降级 | 不生成伪 lap | Planned |
| REG-065 | Streams 全缺失 | Summary 页面可用 | Detail 返回 summary-only bundle | Planned |

## 6. 导入与身份矩阵

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| REG-080 | 同一 hash 导入两次 | 一条活动，第二次 `skipped_exact_duplicate` | Planned |
| REG-081 | 同一 external ID 再同步 | 更新/关联同一来源，不新增活动 | Planned |
| REG-082 | 同一 FIT session identity | 建立精确来源关联 | Planned |
| REG-083 | 时间/距离相近 | `review_required`，不自动合并 | Planned |
| REG-084 | 单个损坏文件 | 该 Item 失败，同批其他成功 | Planned |
| REG-085 | 导入取消 | 已提交保留，未完成停止 | Planned |
| REG-086 | Worker 崩溃 | Job 可识别并重试 | Planned |
| REG-087 | Quota exceeded | 当前事务回滚，无半条活动 | Planned |
| REG-088 | ZIP path traversal | 阻断并记录安全错误 | Planned |
| REG-089 | XML external entity | 阻断，不访问外部资源 | Planned |

## 7. 备份、恢复和分析矩阵

| ID | Scenario | Expected result | Status |
| --- | --- | --- | --- |
| REG-100 | 新浏览器恢复 | 活动、来源、streams、设置完整 | Planned |
| REG-101 | Backup hash 错误 | 恢复前阻断，不覆盖当前库 | Planned |
| REG-102 | Schema 不兼容 | 明确错误，不强制恢复 | Planned |
| REG-103 | 恢复中断 | 当前资料库不被覆盖 | Planned |
| REG-104 | 重复恢复 | 幂等或明确冲突报告 | Planned |
| REG-105 | Analysis version 变化 | 相关 snapshot 标记 stale | Planned |
| REG-106 | FTP/HR zone 变化 | 只失效依赖设置的分析 | Planned |
| REG-107 | 新增历史活动 | 时间线指标正确失效 | Planned |

## 8. 浏览器与视觉矩阵

正式 Release 至少验证：

| Browser | Desktop | Mobile/PWA | Light | Dark |
| --- | --- | --- | --- | --- |
| Chrome 最新两个大版本 | Required | Required | Required | Required |
| Safari 最新两个大版本 | Required | Basic | Required | Required |
| Firefox 最新两个大版本 | Required | Best effort | Required | Required |

大批量导入以桌面端为主要支持场景；移动端必须提供明确限制和错误信息。
