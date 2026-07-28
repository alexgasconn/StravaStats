# StravaStats v2 Release Gates

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related plan | [V2 Development Plan](./v2-development-plan.md) |

## 1. 目的

Release Gate 是阻断条件，不是建议清单。功能“看起来可用”不能替代测试、迁移、隐私和回滚证据。

每项 Gate 必须记录：

| 字段 | 说明 |
| --- | --- |
| Evidence | 日志、测试结果、截图、报告或 PR 链接 |
| Verified by | 验证者 |
| Verified at | 日期与环境 |
| Result | Pass / Fail / Blocked / Not applicable |
| Related PR | 引入或修复该能力的 PR |

没有证据的检查项不得标记为 Pass。

## 2. 当前能力声明

当前仓库只能自动执行：

```text
npm run check:syntax
```

`npm test`、GitHub Actions、E2E 和隐私自动检查计划由 PR-00 Repository Safety 建立。在 PR-00 合并前，这些检查必须标记为 `Not implemented`，不得声称已通过。

## 3. PR Gate

每个功能 PR 必须满足：

- [ ] Task Brief 状态为 `Approved for implementation`；
- [ ] 依赖 PR 已合并；
- [ ] 必需 ADR 已为 `Accepted`，或任务明确不依赖未决部分；
- [ ] 修改文件没有超出允许范围；
- [ ] `npm ci` 成功；
- [ ] `npm run check:syntax` 成功；
- [ ] `npm test` 成功；
- [ ] 本任务专项测试成功；
- [ ] `git diff --check` 无错误；
- [ ] 无真实运动、GPS、健康数据或凭据；
- [ ] 数据迁移影响已说明；
- [ ] 回滚步骤可执行；
- [ ] 人工验收项目已列出；
- [ ] 未执行的验证被明确报告，没有伪装成 Pass。

纯文档 PR 在 `npm test` 尚不存在时，可以按当前仓库能力执行 syntax 和 diff 检查，但必须在 PR 中说明测试基础尚未建立。

## 4. Integration Gate

功能 PR 合入 `integration/v2` 前后必须满足：

- [ ] `integration/v2` CI 通过；
- [ ] Feature Flag 默认值符合当前迁移阶段；
- [ ] Legacy 路径仍可启动；
- [ ] Canonical 写入或读取失败不会破坏 Legacy 数据；
- [ ] 跨 PR Repository、Storage 和 Import 集成测试通过；
- [ ] 热点文件没有未解决的并行冲突；
- [ ] 数据库 migration 可重复执行；
- [ ] 新增错误有可观察、无隐私泄漏的诊断信息。

## 5. Alpha Gate

`v2.0.0-alpha.1` 重点验证架构与 Shadow Mode：

- [ ] Baseline Tag 和 `maintenance/v1` 存在；
- [ ] Legacy Cache 可导出、验证和恢复；
- [ ] Canonical Contracts 已接受；
- [ ] Repository 收口完成；
- [ ] IndexedDB v2 与 Legacy 数据物理隔离；
- [ ] Shadow Writer 不改变页面读取路径；
- [ ] Parity Report 可以导出并解释差异；
- [ ] Feature Flag 可以切回 Legacy。

## 6. Beta Gate

`v2.0.0-beta.1` 重点验证导入和本地使用：

- [ ] Synthetic JSON 纵向切片通过；
- [ ] `activities.csv` 导入通过；
- [ ] Strava ZIP 安全与关联测试通过；
- [ ] FIT、TCX、GPX Decoder 矩阵通过；
- [ ] 同一文件重复导入不生成重复活动；
- [ ] 单文件失败不影响同批成功项目；
- [ ] 无 Strava Token 可以启动并浏览本地数据；
- [ ] Summary-only 和缺失能力场景可以降级；
- [ ] Source Manager 和 Import Report 可用。

## 7. Release Candidate Gate

`v2.0.0-rc.1` 必须满足：

- [ ] CSV/FIT/TCX/GPX 全部通过回归矩阵；
- [ ] 完整资料库备份与新环境恢复通过；
- [ ] Exact Identity Resolver 通过；
- [ ] 模糊重复不会自动合并；
- [ ] 汇总页面 Legacy/Canonical Parity 已审阅；
- [ ] Activity Detail 能读取本地 Streams；
- [ ] Run Plus / NSM 回归通过；
- [ ] Service Worker 更新与旧缓存淘汰策略通过；
- [ ] 5,000/10,000 活动和大 Stream 性能达到预算或记录豁免；
- [ ] 迁移和发布回滚演练完成；
- [ ] 未解决的 P0/P1 缺陷为零。

## 8. Production Release Gate

`v2.0.0` 发布必须满足：

- [ ] 无 Strava Token 正常启动；
- [ ] Strava Disconnect 不删除本地资料库；
- [ ] Legacy Cache 可恢复；
- [ ] CI 全部通过；
- [ ] 所有 P0 数据源导入通过；
- [ ] 数据库备份恢复通过；
- [ ] Exact Duplicate 通过；
- [ ] 汇总页面 Parity 通过；
- [ ] 详情页能力降级通过；
- [ ] Run Plus / NSM 通过；
- [ ] Shadow 差异已审阅；
- [ ] Canonical 可以切回 Legacy；
- [ ] 无隐私数据进入 Git、日志或外部埋点；
- [ ] Migration、Backup、Privacy、Troubleshooting 文档完成；
- [ ] 最终回滚演练完成；
- [ ] 发布负责人明确批准。

## 9. 豁免政策

以下项目不得豁免：

- 数据丢失风险；
- 破坏 Legacy Cache；
- 真实隐私数据进入 Git 或日志；
- 无法回滚；
- Exact Duplicate 产生第二条活动；
- Strava Disconnect 删除本地活动；
- 未经授权把活动数据发送外部服务。

性能、浏览器边缘兼容等非数据安全项可以提出限时豁免，但必须记录：

- 原因；
- 用户影响；
- 临时缓解；
- Owner；
- 到期日期；
- 后续任务。

## 10. Gate 失败处理

Gate 失败时：

1. 停止合并或发布；
2. 保存失败证据和环境信息；
3. 判断是代码缺陷、测试缺陷还是环境问题；
4. 创建范围明确的修复任务；
5. 重新执行全部受影响 Gate；
6. 不通过修改检查结果或删除失败测试来绕过。
