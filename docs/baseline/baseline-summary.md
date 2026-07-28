# StravaStats V1 基线摘要

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Code baseline | `8b16ebe1a706f1713602ab5266e47000caf31a17` |
| Baseline tag | 尚未创建；以实际验证日期命名 |
| Validation date | 尚未完成 |
| Evidence classification | Repository-safe summary |

## 1. 环境

在完成基线验证时填写：

```text
Operating system:
Node:
npm:
Browser:
Browser version:
Local server command:
Port:
Service Worker state:
```

## 2. 自动检查

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Not run | |
| `npm run check:syntax` | Pass（文档准备前检查） | 90 files |
| `npm test` | Not implemented | PR-00 |
| CI | Not implemented | PR-00 |

## 3. 人工页面验证

| Page/flow | Result | Notes |
| --- | --- | --- |
| Dashboard | Not verified | |
| Activities | Not verified | |
| Run | Not verified | |
| Run Plus | Not verified | |
| NSM | Not verified | |
| Bike | Not verified | |
| Swim | Not verified | |
| Settings | Not verified | |
| Activity Detail | Not verified | |
| Map | Not verified | |
| Gear | Not verified | |
| Disconnect/Logout | Not verified | 注意当前可能删除 Legacy Cache |

## 4. 已知结构性限制

- 当前依赖 Strava API；
- 当前没有 `npm test` 和 CI；
- 页面中仍有直接 `/api/strava-*` 调用；
- Legacy IndexedDB 是缓存，不是长期资料库；
- logout/disconnect 与活动缓存清理耦合；
- localhost Service Worker 可能影响多个 worktree 验证；
- 完整真实数据证据必须保存在仓库外。

## 5. 私有证据

真实活动计数、时间范围、统计值、截图和 Legacy 导出只保存在仓库外。本文件不得写入私人目录中的文件内容。

## 6. 完成标准

- [ ] 环境信息填写完成；
- [ ]主要页面人工验证完成；
- [ ] Legacy Cache 已导出并私下保存；
- [ ]已知问题已记录；
- [ ] Baseline Tag 指向验证过的 commit；
- [ ] `maintenance/v1` 和 `integration/v2` 已从基线创建；
- [ ]仓库内没有真实运动数据或截图。
