# StravaStats v2 回滚计划

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related gates | [Release Gates](../engineering/release-gates.md) |

## 1. 目标

回滚不是“重新部署旧 commit”这么简单。V2 需要分别处理应用代码、Feature Flag、Service Worker、IndexedDB、导入数据、备份和用户期望。

任何回滚都不得为了恢复页面而删除用户资料。

## 2. 不变量

- Legacy DB 不被 V2 原地升级；
- V2 DB 不反向写入 Legacy Cache；
- 切换模式不删除任一数据库；
- RawArtifact 和私人备份不因应用回滚被删除；
- 恢复失败不覆盖当前可用资料库；
- 用户明确执行“删除资料库”之前，Disconnect/Logout/Token 失败均不删除活动；
- 每个 PR 必须记录数据影响和 rollback command/procedure。

## 3. 回滚层次

### 3.1 Feature Flag 回滚

首选紧急恢复：

```js
dataRepositoryMode = 'legacy'
```

预期：

- 页面重新使用 Legacy Repository；
- Canonical DB 保留；
- 后台双写/导入按故障范围关闭；
- 记录 fallback 原因；
- 不要求用户重新授权即可读取现有 Legacy 数据。

适用于 Repository、Projection、Canonical 读取和页面 cutover 问题。

### 3.2 单 PR 回滚

每个 PR 描述必须包含：

```text
Revert target
Feature Flag
Changed database/schema
Created user data
Cache/Service Worker impact
Recovery verification
```

优先使用新的 revert commit，不改写共享历史。若 PR 已写入用户数据，先评估兼容性和导出，再回滚代码。

### 3.3 发布回滚

```text
停止新部署
→ Feature Flag 切 Legacy
→ Vercel 回退上一稳定部署
→ 更新/清理对应 Service Worker cache version
→ Revert Release PR
→ 执行 Legacy smoke test
→ 保存故障和回滚证据
```

Service Worker 必须与部署回滚一起处理，否则浏览器可能继续运行新旧混合资源。

### 3.4 用户数据恢复

数据恢复与应用回滚分开：

1.冻结新的导入/merge；
2.导出当前 V2 资料库；
3.验证最近成功备份；
4.在 staging 数据库恢复；
5.校验 hash、record count、时间范围和引用完整性；
6.用户确认；
7.切换到恢复后的数据库或明确导入；
8.保留故障库用于诊断，除非用户确认删除。

## 4. 场景 Runbook

### Canonical 页面结果错误

```text
切回 legacy
→ 导出 Parity Report
→ 禁止继续 cutover
→ 保留 Canonical DB
→ 创建回归任务
```

### Shadow 写入失败

```text
页面继续 Legacy
→ 关闭 canonicalShadowWriteEnabled
→ 保存错误与 Import/Migration 状态
→ 不重建或清空 V2 DB
```

### IndexedDB migration 失败

```text
停止新写入
→ 事务自动回滚
→ migration 标记 failed
→ 切 Legacy
→ 导出诊断
→ 修复后在副本/测试环境重试
```

### 导入造成错误活动

```text
停止相关 Import Job
→ 保留 RawArtifact 和 Import Log
→ 识别受影响 activityIds
→ 禁用相关 Decoder 版本
→ 从备份或重新解析恢复
→ 不进行模糊批量删除
```

### Strava Disconnect 删除风险

如果发现 disconnect 仍会删除本地活动：

```text
立即阻止 PR/发布
→ 禁用 disconnect 操作或切旧 UI
→ 尝试 Legacy Rescue Reader
→ 从私人导出恢复
→ 增加回归测试
```

### Service Worker 混合版本

```text
确认当前 deployment 和 cache version
→ 停止注册错误 worker
→ 激活正确版本
→ 提供人工 unregister/cache cleanup 指引
→ 重新执行页面 smoke test
```

## 5. 数据兼容窗口

V2 正式发布后仍需保留：

- Legacy Repository；
- Legacy Cache Reader；
- `dataRepositoryMode=legacy`；
- Legacy migration/export 工具；
- 至少一个经过验证的 V1 部署/标签。

删除时间必须由独立任务、使用数据和回滚演练决定，不与 V2 首次发布绑定。

## 6. 回滚演练

Release Candidate 前至少演练：

1. canonical → legacy；
2.失败 migration → legacy；
3.坏部署 → 上一部署；
4. Service Worker 新旧版本切换；
5.空浏览器从备份恢复；
6.恢复中断；
7.断开 Strava 后继续浏览本地活动。

每次演练记录：

```text
date
commit/deployment
browser
database versions
steps
result
duration
data counts
unexpected behavior
follow-up
```

真实数据计数和截图保存在私有证据目录。

## 7. Stop conditions

以下情况不得继续发布：

- 无法切回 Legacy；
- 旧缓存不可读且无备份；
- migration 不幂等；
- 恢复会覆盖当前资料库；
- Service Worker 无法稳定切换；
- 回滚要求手工删除整个站点数据；
- 故障可能泄露隐私；
- 没有明确 Owner 和恢复证据。

## 8. Ownership

每次发布必须指定：

- Release owner；
- Migration owner；
- Rollback decision owner；
- 验证者；
- 用户沟通负责人。

个人项目中可以是同一人，但角色和确认动作仍需记录。
