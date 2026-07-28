# 第二部分：完整工程开发计划

# 21. Git 与 Worktree 总体架构

## 21.1 长期分支

```text
main
│
├── maintenance/v1
│
└── integration/v2
```

含义：

| 分支               | 用途                        |
| ---------------- | ------------------------- |
| `main`           | 稳定生产版本                    |
| `maintenance/v1` | 仅处理旧版严重 Bug、安全和 Strava 兼容 |
| `integration/v2` | v2 所有功能的集成和验证             |

长期分支不使用 `codex/` 前缀。

## 21.2 功能分支

```text
codex/v2/repo-safety
codex/v2/legacy-rescue
codex/v2/contracts
codex/v2/repository
codex/v2/storage
codex/v2/shadow-writer
codex/v2/import-core
codex/v2/strava-csv
codex/v2/strava-zip
codex/v2/decoder-fit
codex/v2/decoder-tcx
codex/v2/decoder-gpx
codex/v2/source-ui
codex/v2/local-first-bootstrap
codex/v2/cutover-summary
codex/v2/cutover-detail
codex/v2/cutover-run-plus
codex/v2/exact-identity
codex/v2/backup-restore
```

## 21.3 Worktree 目录

```text
/Users/wangchuanliang/Documents/StravaStats
└── main

/Users/wangchuanliang/Documents/StravaStats-worktrees/
├── v1
├── v2
├── repo-safety
├── legacy-rescue
├── contracts
├── repository
├── storage
├── shadow-writer
├── import-core
├── strava-csv
├── strava-zip
├── decoder-fit
├── decoder-tcx
├── decoder-gpx
├── source-ui
└── cutover
```

## 21.4 Worktree 强制规则

1. 一个 Worktree 只对应一个分支；
2. 一个 Worktree 同一时间只交给一个 Agent；
3. Feature Agent 不允许修改 `main` 或 `integration/v2`；
4. `integration/v2` Worktree 只用于拉取、集成测试和 Release；
5. Worktree 不允许反复 `git switch`；
6. PR 合并后删除 Feature Worktree；
7. 多 Agent 并行时，热点文件必须有唯一 Owner。

---

# 22. 仓库安全初始化

## 22.1 创建基线

```bash
cd /Users/wangchuanliang/Documents/StravaStats

git switch main
git pull --ff-only origin main

npm ci
npm run check:syntax
PORT=3001 npm run dev
```

验证主要页面后：

```bash
git tag -a baseline-strava-api-2026-07-27 \
  -m "Stable Strava API version with Run Plus and NSM before local-first v2 migration"

git push origin baseline-strava-api-2026-07-27
```

## 22.2 创建长期分支

```bash
git branch maintenance/v1 main
git branch integration/v2 main

git push -u origin maintenance/v1
git push -u origin integration/v2
```

## 22.3 创建永久 Worktree

```bash
WT_ROOT=/Users/wangchuanliang/Documents/StravaStats-worktrees

mkdir -p "$WT_ROOT"

git worktree add "$WT_ROOT/v1" maintenance/v1
git worktree add "$WT_ROOT/v2" integration/v2

git worktree lock \
  --reason "Long-lived v1 maintenance worktree" \
  "$WT_ROOT/v1"

git worktree lock \
  --reason "Long-lived v2 integration worktree" \
  "$WT_ROOT/v2"
```

---

# 23. PR 拆分原则

每个 PR 必须：

* 只解决一个架构问题；
* 有明确输入、输出和回滚方式；
* 不同时修改数据模型和页面视觉；
* 不同时迁移数据来源和修改分析算法；
* 不直接提交真实 FIT/TCX/GPX；
* 包含相应测试；
* 通过 CI；
* 有 Feature Flag 或兼容层；
* 不删除旧数据路径。

---

# 24. 双周 Sprint 计划

## Sprint 0：仓库与数据安全

### PR 00：Repository Safety

**分支：**

```text
codex/v2/repo-safety
```

**工作内容：**

* `.gitignore` 增加隐私路径；
* 根目录增加 `AGENTS.md`；
* 测试目录建立时增加 `tests/AGENTS.md`；
* 增加 PR Template；
* 增加 GitHub Actions；
* 增加 `npm test`；
* 增加最小测试目录；
* localhost 默认禁用 Service Worker；
* 增加 Feature Flag 骨架；
* 增加确定性 Demo Seed。

**允许修改：**

```text
.gitignore
AGENTS.md
.github/
package.json
scripts/
sw.js
js/app/feature-flags.js
tests/
```

**禁止修改：**

```text
Canonical Schema
IndexedDB v2
现有分析算法
页面视觉
```

**验收：**

```text
npm ci
npm run check:syntax
npm test
CI 通过
主页面视觉不变
localhost 无旧 Service Worker 干扰
```

**分层 `AGENTS.md` 排期：**

| 文件 | 创建阶段 | 作用 |
| --- | --- | --- |
| `AGENTS.md` | PR-00 Repository Safety | 全仓库目标、事实优先级、隐私、Git、测试和交付规则 |
| `tests/AGENTS.md` | PR-00 Repository Safety | Synthetic fixture、无网络测试、私有数据和测试证据规则 |
| `js/data/AGENTS.md` | PR-02 Canonical Contracts | Canonical、Repository、Decoder、Storage 的领域边界 |
| `js/tabs/AGENTS.md` | PR-04A Consumer Migration 前 | 页面消费者边界、禁止直接 API/IndexedDB、视觉回归规则 |
| `js/analysis/AGENTS.md` | 正式修改分析算法前 | 算法版本、确定性、回归、分析与数据迁移分离规则 |

子目录 `AGENTS.md` 只补充该目录特有约束，不复制或削弱根规则。目录尚不存在或职责尚未冻结时，不提前创建空泛规则文件。

---

### PR 01：Legacy Cache Rescue 与鉴权解耦

**分支：**

```text
codex/v2/legacy-rescue
```

**工作内容：**

* 增加旧缓存不检查 TTL 的 Rescue Reader；
* 增加旧缓存导出；
* 将 Disconnect Strava 与 Delete Data 分离；
* Token 过期不删除本地活动；
* Demo Token 逻辑逐步隔离；
* 增加旧缓存恢复测试。

**重点文件：**

```text
js/app/auth.js
js/services/activity-cache.js
js/demo/
tests/legacy/
```

**验收：**

* 登出不再删除活动；
* Token 过期不删除活动；
* 旧缓存可导出；
* 清空环境后可恢复；
* Legacy 页面行为无变化。

---

## Sprint 1：架构契约与数据访问边界

### PR 02：ADR 与 Canonical Contracts

**分支：**

```text
codex/v2/contracts
```

**内容：**

```text
CanonicalActivity
CanonicalStreamSet
Lap
Event
SourceReference
Capabilities
Version Metadata
ImportedActivityBundle
```

**文档：**

```text
ADR-0001 Canonical Activity
ADR-0002 Stream Model
ADR-0003 Repository Boundary
ADR-0004 Import Pipeline
ADR-0005 Analysis Versioning
ADR-0006 Source Provenance
```

**验收：**

* Runtime Schema 校验；
* 单位测试；
* String ID；
* 缺失值不转为 0；
* 不改变运行时页面。

---

### PR 03：Legacy Repository 与 Strava Connector

**分支：**

```text
codex/v2/repository
```

**内容：**

* 封装当前 `services/api.js`；
* 引入 Repository Interface；
* 创建 StravaApiConnector；
* 创建 Repository Factory；
* 当前行为保持一致。

**接口：**

```text
listActivities
getActivity
getStreams
getLaps
getAthlete
getZones
getGears
```

**验收：**

旧调用与 Repository 返回结果一致。

---

## Sprint 2：消费者迁移与新数据库

### PR 04A：汇总页面消费者迁移

涉及：

```text
main.js
Dashboard
Activities
Calendar
Run summary
Bike summary
Swim summary
Map
Gear
Wrapped
```

要求：

* 页面只调用 Repository；
* 页面目录中不再直接出现 `/api/strava-*`；
* 输出不变。

### PR 04B：活动详情消费者迁移

涉及：

```text
activity-router
activity.js
run.js
bike.js
swim.js
advanced-analysis.js
```

要求：

* 一个详情页只获取一次 ActivityBundle；
* Advanced Analysis 不重复请求。

### PR 04C：Run Plus / NSM 消费者迁移

只允许一个 Agent 修改：

```text
js/tabs/run-plus.js
styles/run-plus.css
```

本 PR 只替换取数边界，不拆分算法或视觉。

---

### PR 05：IndexedDB v2 Schema

**分支：**

```text
codex/v2/storage
```

**内容：**

* 新数据库 `strava-stats-v2`；
* Object Stores；
* Repository Adapter；
* Transaction；
* Migration Framework；
* Backup Manifest 基础；
* `fake-indexeddb` 测试。

**禁止：**

* 不覆盖 `strava-dashboard-cache`；
* 不切换页面读取来源；
* 不删除 Legacy Cache。

**验收：**

* 空库初始化；
* 重复初始化；
* Migration 中断；
* Migration 重试；
* Quota Error；
* 事务回滚。

---

## Sprint 3：Shadow Mode 与导入主干

### PR 06：Shadow Canonical Writer

**分支：**

```text
codex/v2/shadow-writer
```

数据流：

```text
当前 Strava API
├── Legacy Cache → 页面
└── Canonical Store → Parity Report
```

**Parity Report：**

```text
活动数量
ID 对应
距离
时间
日期
运动类型
心率
功率
装备
```

**验收：**

* 页面仍读 Legacy；
* Canonical 自动双写；
* 差异可以导出；
* Canonical 写入失败不影响 Legacy 页面；
* 不允许静默差异。

---

### PR 07：Import Core + Canonical JSON Fixture

**分支：**

```text
codex/v2/import-core
```

实现：

```text
ImportJob
ImportItem
RawArtifact
DecoderRegistry
Normalizer
Import Worker
Transaction Writer
Import Report
```

先使用人工 Synthetic JSON，不直接开发 FIT。

**纵向切片：**

```text
Synthetic File
→ Decoder
→ Canonical Store
→ Repository
→ Activities Preview
```

**验收：**

* 导入可取消；
* 同一 fixture 重复导入不重复；
* 单 Item 失败不影响其他 Item；
* 页面刷新后 Import Log 保留；
* Worker 崩溃可重试。

---

## Sprint 4：Strava 归档与基础 UI

### PR 08：activities.csv

实现：

* Header Mapping；
* 日期解析；
* 单位转换；
* Summary-only Activity；
* CSV 缺失列；
* CSV 多语言字段映射预留。

**验收：**

* 与 Strava API 汇总结果对比；
* Dashboard/Activities Preview 可用；
* 只有摘要时详情页不崩溃。

### PR 09：Strava ZIP

实现：

* ZIP 解压；
* `activities.csv` 识别；
* 原始活动文件关联；
* ZIP bomb 检查；
* Path traversal 检查；
* 文件数量和总大小限制。

### PR 10：Source Manager 基础 UI

实现：

```text
First-run
Source Cards
Import Dialog
Import Progress
Import Report
```

本 PR 不进行页面全面切换。

---

## Sprint 5：文件 Decoder

### PR 11：FIT Decoder

**独立 Worktree：**

```text
decoder-fit
```

支持：

```text
file_id
device_info
session
record
lap
event
hr
```

测试矩阵：

```text
Garmin Run
Garmin Pool Swim
COROS Run
Wahoo Ride
Zwift Ride
Indoor Run
No GPS
No HR
Split records
CRC warning
Pause/Resume
```

### PR 12：TCX Decoder

支持：

* XML Namespace；
* 多 Lap；
* 多 Track；
* Polar 缺速度；
* Suunto 高度异常；
* Power/Temperature Extensions。

### PR 13：GPX Decoder

支持：

* Track/Segment/Point；
* GPS；
* Elevation；
* HR/Cadence/Power Extensions；
* 时间缺失和异常高度。

### PR 14：Decoder Registry Wiring

由单一 Agent 修改中央 Registry，将 FIT、TCX、GPX 正式注册。

---

## Sprint 6：Local-first 页面切换

### PR 15：Local-first Bootstrap

**内容：**

* 启动先打开本地资料库；
* 无活动进入 First-run；
* 有活动直接进入 Dashboard；
* Strava 登录变为可选；
* Source Status；
* 网络离线时本地功能正常。

### PR 16：汇总页面 Canonical Cutover

顺序：

```text
Activities
Calendar
Wrapped
Dashboard
Run
Bike
Swim
Gear
Map
Planner
```

每个页面：

```text
legacy
→ shadow comparison
→ canonical flag
→ default canonical
```

### PR 17：详情页 Canonical Cutover

```text
Canonical ActivityBundle
→ Legacy Detail Projection
→ Existing Detail UI
```

无 GPS、无心率、无功率时必须能力降级。

### PR 18：Run Plus / NSM Cutover

重点回归：

```text
NSM Settings
Activity Tags
Interval Analysis
Impact Load
TSS
CTL
ATL
TSB
Filtering
LocalStorage migration
```

---

## Sprint 7：身份、合并、备份与恢复

### PR 19：Exact Identity Resolver

自动处理：

```text
Source external ID
SHA-256
FIT session identity
已建立来源关联
```

不做模糊自动合并。

### PR 20：Merge Candidate Review

实现：

* Candidate；
* Confidence；
* Review UI；
* Confirm same activity；
* Keep separate；
* Audit log。

字段级合并和 Unmerge 可作为 P1 后续独立 PR。

### PR 21：Backup / Restore

测试：

* 新环境恢复；
* Hash 错误；
* Schema 不兼容；
* 恢复中断；
* 恢复重复执行；
* 恢复失败不覆盖现有数据。

### PR 22：Diagnostics 与性能

实现：

* 诊断导出；
* Storage Estimate；
* Import 性能记录；
* 页面错误记录；
* Stream 降采样；
* 大规模活动性能测试。

---

## Sprint 8：Release Candidate

### PR 23：Feature Flag 默认切换

```js
dataRepositoryMode = 'canonical'
```

Legacy 仍保留为回滚选项。

### PR 24：Release Documentation

更新：

```text
README
CHANGELOG
Migration Guide
Backup Guide
Known Limitations
Privacy Guide
Troubleshooting
```

发布阶段：

```text
v2.0.0-alpha.1
v2.0.0-beta.1
v2.0.0-rc.1
v2.0.0
```

---

# 25. 并行开发矩阵

## 可以并行

在 Contract 冻结后：

```text
FIT Decoder
TCX Decoder
GPX Decoder
Synthetic Fixtures
Source Manager 静态 UI
文档
独立测试
```

## 必须串行

```text
Repo Safety
→ Contracts
→ Repository
→ IndexedDB Schema
→ Shadow Writer
→ Import Core
→ Bootstrap
→ 页面 Cutover
```

## 热点文件唯一 Owner

| 文件                         | 规则           |
| -------------------------- | ------------ |
| `package.json`             | 同一时间一个 Agent |
| `js/app/main.js`           | 同一时间一个 Agent |
| `js/app/auth.js`           | 同一时间一个 Agent |
| `js/tabs/run-plus.js`      | 同一时间一个 Agent |
| `styles/run-plus.css`      | 同一时间一个 Agent |
| `sw.js`                    | 同一时间一个 Agent |
| `decoder-registry.js`      | 同一时间一个 Agent |
| IndexedDB Schema/Migration | 同一时间一个 Agent |

---

# 26. 测试策略

## 26.1 单元测试

重点：

```text
Schema Validation
Unit Conversion
Sport Taxonomy
Date/Timezone
CSV Header Mapping
FIT Mapping
TCX Mapping
GPX Mapping
Fingerprint
Identity Resolver
Merge Policy
Analysis Version Hash
```

## 26.2 集成测试

```text
Import Pipeline
IndexedDB Transaction
Import Retry
Shadow Write
Legacy Projection
Backup Restore
Database Migration
Repository Fallback
```

## 26.3 E2E

```text
首次打开
加载 Demo
导入 CSV
导入 FIT
重复导入
取消导入
查看 Import Report
打开 Dashboard
打开 Activity Detail
断开 Strava
离线打开
创建备份
清空资料库
恢复备份
切换 Legacy/Canonical
```

## 26.4 视觉回归

```text
Desktop Light
Desktop Dark
Mobile Light
Mobile Dark
No Data
Summary-only
Full Streams
Missing GPS
Missing HR
Error State
```

## 26.5 安全测试

```text
XSS activity name
XML external entity
ZIP path traversal
ZIP bomb
Invalid FIT header
Huge file
Huge number of files
Malformed backup
Private data Git guard
```

## 26.6 性能测试

```text
5,000 activities
10,000 activities
1,000 FIT batch
200,000-point activity
Multiple simultaneous imports
Worker cancellation
IndexedDB quota pressure
```

---

# 27. Release 门禁

v2.0.0 不得仅因为“功能已写完”而发布。

必须满足：

```text
[ ] Baseline Tag 存在
[ ] v1 维护分支存在
[ ] Legacy Cache 可恢复
[ ] CI 全部通过
[ ] CSV/FIT/TCX/GPX 导入通过
[ ] 资料库备份恢复通过
[ ] Exact Duplicate 通过
[ ] Strava 断开不删除数据
[ ] 无 Token 启动通过
[ ] 汇总页面 Parity 通过
[ ] 详情页能力降级通过
[ ] Run Plus / NSM 回归通过
[ ] Shadow 差异已审阅
[ ] Canonical 可切回 Legacy
[ ] Service Worker 更新策略通过
[ ] 无隐私数据进入日志或 Git
[ ] Migration Guide 完成
[ ] 回滚演练完成
```

---

# 28. 回滚方案

## 28.1 应用回滚

```js
dataRepositoryMode = 'legacy'
```

立即恢复旧 Repository。

## 28.2 数据库回滚

* 不删除 IndexedDB v2；
* 不把 v2 数据反向写入旧缓存；
* 旧缓存保持可读；
* 用户可导出 v2 备份后回退。

## 28.3 发布回滚

```text
Vercel 回退上一稳定部署
Service Worker Cache Version 更新
主分支 Revert Release PR
```

## 28.4 单 PR 回滚

每个 PR 描述必须包含：

```text
Feature Flag
Revert Commit
数据库影响
数据恢复方式
是否需要清理 Cache
```

---

# 29. Codex 任务模板

后续每个任务统一使用以下格式：

```text
仓库：
XiChuan9/StravaStats

基线：
origin/integration/v2

分支：
codex/v2/<task-name>

Worktree：
/Users/wangchuanliang/Documents/StravaStats-worktrees/<task-name>

任务目标：
<一句话描述>

允许修改：
<明确目录和文件>

禁止修改：
- main
- integration/v2
- 未授权热点文件
- local-data
- tests/fixtures/private
- 现有分析算法，除非任务明确要求
- 旧 IndexedDB 数据库结构

工程约束：
- 不使用 git add .
- 不直接合并 PR
- 不删除旧数据路径
- 不把缺失值转换成 0
- 不让页面直接调用第三方 API
- 不上传真实运动数据
- 所有 ID 使用字符串

必须测试：
- npm ci
- npm run check:syntax
- npm test
- <本任务专属测试>

交付内容：
1. 修改文件清单
2. 设计说明
3. 测试结果
4. 已知限制
5. 数据迁移影响
6. 回滚方式
7. 提交 SHA
8. PR 地址
```

---

# 30. 最终开发顺序

```text
基线与安全
→ CI 和测试
→ 旧缓存救援
→ 鉴权与数据生命周期解耦
→ ADR 与 Canonical Contract
→ Repository
→ 页面直接 API 调用收口
→ IndexedDB v2
→ Shadow Write 和 Parity Report
→ Import Core 纵向切片
→ activities.csv
→ Strava ZIP
→ FIT / TCX / GPX
→ Source Manager
→ Local-first 启动
→ 汇总页面切换
→ 详情页切换
→ Run Plus / NSM 切换
→ Exact Identity
→ Duplicate Review
→ Backup / Restore
→ Diagnostics / Performance
→ Alpha
→ Beta
→ Release Candidate
→ v2.0.0
```

这份计划的核心不是“把所有代码尽快重写”，而是始终保证：

```text
旧版本可运行
新版本可验证
新旧结果可比较
数据不会被覆盖
任何阶段可回退
失败后可恢复
问题可以定位
多个 Codex Agent 不互相污染
```
