# StravaStats V1 基线摘要

| 字段 | 内容 |
| --- | --- |
| Status | Verified with limitations |
| Owner | XiChuan9 |
| Runtime baseline | `8b16ebe1a706f1713602ab5266e47000caf31a17` |
| Tagged baseline | `fe34535c39db421434a5e28cd26a57b3f71130e2` |
| Baseline tag | `baseline-strava-api-2026-07-28` |
| Validation date | 2026-07-28 |
| Evidence classification | Repository-safe summary |

## 1. 环境

```text
Operating system: macOS 15.7.3 arm64
Node: v25.8.1
npm: 11.11.0
Browser: Codex in-app Chromium
Browser version: Not exposed by the automation surface
Local server command: PORT=3001 npm run dev
Port: 3001
Service Worker state: V1 auto-registration present; PR-00 replaces localhost behavior
```

## 2. 自动检查

| Check | Result | Evidence |
| --- | --- | --- |
| `npm ci` | Pass | 5 packages installed; 0 vulnerabilities |
| `npm run check:syntax` | Pass | 90 files at tagged baseline |
| Static HTTP smoke | Pass | `/`、`index.html`、Activity Router、`main.js`、`sw.js` returned 200 |
| `npm test` | Not implemented at tag | Implemented by PR-00 |
| CI | Not implemented at tag | Implemented by PR-00 |

## 3. 无账号自动页面验证

| Page/flow | Result | Notes |
| --- | --- | --- |
| Dashboard | Pass | Demo 数据成功渲染 |
| Activities | Pass | Demo 活动表成功渲染 |
| Run | Pass | Demo 汇总与图表容器成功渲染 |
| Run Plus | Pass | Training Diagnosis 成功渲染 |
| NSM | Pass | NSM Training Control 成功渲染 |
| Bike | Pass | Demo 骑行汇总成功渲染 |
| Swim | Pass | Demo 游泳汇总成功渲染 |
| Settings | Pass | 自动化 Demo 导航在关闭现有 Support Modal 后成功渲染 |
| Activity Detail | Known limitation | Demo 列表可进入 Router，但受保护 API 返回 401 |
| Map | Not run | 非本次最低冒烟集合 |
| Gear | Pass | Demo 装备卡片成功渲染 |
| Disconnect/Logout | Not run | 不在没有 Legacy 私有备份时触发破坏性路径 |

真实 Strava OAuth 因开发者订阅限制未执行。上述结果只证明无账号 Demo
和静态入口的基线行为，不代表真实 Strava API 集成通过。

## 4. 已知结构性限制

- 当前依赖 Strava API；
- Tagged baseline 没有 `npm test` 和 CI；
- 页面中仍有直接 `/api/strava-*` 调用；
- 无 Authorization 的本地 `/api/strava-athlete` 返回 500；
- Demo Activity Detail 不能完全离线工作；
- Legacy IndexedDB 是缓存，不是长期资料库；
- logout/disconnect 与活动缓存清理耦合；
- localhost Service Worker 可能影响多个 worktree 验证；
- 完整真实数据证据必须保存在仓库外。

## 5. 私有证据

真实活动计数、时间范围、统计值、截图和 Legacy 导出只保存在仓库外。本文件不得写入私人目录中的文件内容。

## 6. 完成标准

- [x] 环境信息填写完成；
- [x] 可执行的主要页面已完成无账号自动验证；
- [ ] Legacy Cache 已导出并私下保存（当前无可登录账号，保持阻断）；
- [x] 已知问题已记录；
- [x] Baseline Tag 指向验证过的 commit；
- [x] `maintenance/v1` 和 `integration/v2` 已从基线创建；
- [x] 仓库内没有真实运动数据或截图。
