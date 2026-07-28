# Legacy Cache Rescue

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Target implementation | PR-01 Legacy Cache Rescue |

## 1. 目的

在任何 IndexedDB v2、Canonical 双写或本地导入开发之前，必须先确保现有活动缓存可以绕过 TTL 被发现、导出、校验和恢复。

Git 回滚不能恢复浏览器 IndexedDB。旧数据救援是 V2 开工的阻断条件。

## 2. 当前 Legacy 数据清单

### IndexedDB

```text
Database: strava-dashboard-cache
Version: 1
Store: entries
Primary key: key
Activity key: strava_activities
Value:
  activities
  timestamp
  cacheVersion
```

### localStorage fallback 和 metadata

```text
strava_activities
strava_activities_timestamp
strava_cache_version
strava_athlete_data
strava_training_zones
strava_gears
dashboard_filters
dashboard_readiness_hrv
strava_demo_mode
strava_demo_activities
```

以上清单必须在 PR-01 调查阶段重新与代码核对。

## 3. 当前风险

- `getCachedActivities` 会检查 cache version 和 TTL，过期不等于数据不存在；
- IndexedDB 不可用时会回退 localStorage；
- 当前 logout/disconnect 调用 `clearCachedActivities()`；
- Token、Source Connection 和 Local Library 生命周期耦合；
- localStorage quota 和 JSON parse 错误可能使 fallback 不可读；
- Service Worker/多 worktree 可能让人工验证读取错误版本前端；
- 用户可能只有一个浏览器副本，没有外部备份。

## 4. Rescue Reader 要求

Rescue Reader 必须：

1. 只读打开 Legacy DB；
2.不检查 TTL；
3.允许读取 cacheVersion 不匹配的 entry；
4.区分 IndexedDB、localStorage 和 Demo 数据；
5.不修改 timestamp、version 或 entry；
6.不触发 Strava 网络请求；
7.返回数据来源、活动数量、时间范围和解析 warning；
8.无法读取时返回明确错误，不执行清理；
9.可被自动测试。

Rescue Reader 不得成为 V2 Canonical Store 的长期 Repository。

## 5. 导出格式

第一版导出至少包含：

```text
manifest.json
legacy-activities.json
legacy-athlete.json
legacy-zones.json
legacy-gears.json
legacy-settings.json
```

Manifest 至少记录：

```text
formatVersion
exportedAt
sourceDatabase
sourceDatabaseVersion
sourceCacheVersion
activityCount
earliestActivity
latestActivity
files + sha256
warnings
applicationCommit
```

导出文件属于私人健康资料，不得提交 Git。

## 6. 导出验证

导出成功后必须验证：

- manifest 可解析；
- 每个文件 hash 匹配；
- 活动数组可解析；
- 活动数量与读取结果一致；
- 最早/最晚活动日期合理；
- 至少抽查 Run、Bike、Swim；
- 导出失败不会清理原缓存；
- 空缓存与读取错误可区分。

不要以总距离或心率作为公开证据；这些数据只保留在私有验证记录。

## 7. 鉴权与数据生命周期解耦

目标行为：

```text
Disconnect Strava
→ 删除/撤销 Token 与 Source Connection
→ 保留 Legacy/Canonical Local Library
```

删除本地资料库必须是独立、明确、二次确认的操作。Token 过期、刷新失败、403、401、logout 或切换 Connector 都不得自动删除本地活动。

## 8. 恢复流程

1. 选择 Legacy 导出；
2.校验 manifest 和 hashes；
3.在隔离环境解析；
4.展示活动数量、时间范围和 warning；
5.用户确认；
6.写入明确目标：
   - Legacy 恢复；或
   -未来 Canonical Import Pipeline；
7.写入失败事务回滚；
8.恢复报告记录 imported/skipped/failed；
9.恢复不删除导出包。

PR-01 只需保证 Legacy 导出和可验证恢复路径；完整 Canonical Backup/Restore 属于 PR-21。

## 9. Stop conditions

以下任一情况发生时，禁止开始 IndexedDB v2 用户数据迁移：

- 无法只读打开旧库；
- 无法导出；
- 导出 hash 或 activity count 不一致；
- logout 仍会删除唯一活动副本；
- 恢复测试覆盖不足；
- 真实导出没有安全保存位置；
- 用户无法区分“断开 Strava”和“删除资料库”。

## 10. Acceptance criteria

- [ ] Rescue Reader 无 TTL 读取 IndexedDB；
- [ ] localStorage fallback 可识别；
- [ ]旧缓存可以导出；
- [ ]导出包含 manifest 和 hash；
- [ ]导出后旧库字节内容没有被修改；
- [ ] logout/disconnect 不删除活动；
- [ ] Token 失效不删除活动；
- [ ]恢复流程有自动测试和人工演练；
- [ ]错误不会触发清理；
- [ ]隐私文件没有进入 Git。

## 11. Rollback

PR-01 回滚必须恢复旧运行代码，但在回滚前确认：

- 新代码是否已经改变 logout 行为；
- 是否创建了导出文件；
- 是否需要注销 Service Worker；
- 浏览器中是否已有用户依赖“disconnect 不删除数据”的新行为。

回滚不得删除已生成的私人备份。
