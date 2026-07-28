# StravaStats v2 测试策略

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Related gates | [Release Gates](../engineering/release-gates.md) |

## 1. 目标

测试体系必须证明：

- 迁移没有破坏 V1 行为；
- 同一输入得到确定性结果；
- 数据导入幂等、事务化且可恢复；
- 缺失 GPS、HR、Power、Laps 时正确降级；
- Legacy、Shadow、Canonical 的差异可解释；
- 数据库升级和回滚不会丢失用户数据；
- 测试不依赖真实用户资料、网络或 Token。

## 2. 当前状态

当前 `package.json` 只有：

```text
npm run dev
npm run check:syntax
```

PR-00 将建立 `npm test`、最小单元测试和 GitHub Actions。在此之前，本文描述的是目标策略，不代表相关测试已经存在或通过。

## 3. 测试目录

建议结构：

```text
tests/
├── unit/
├── contracts/
├── repository/
├── storage/
├── import/
├── decoders/
├── integration/
├── e2e/
├── performance/
└── fixtures/
    └── synthetic/
```

私有验证数据必须位于仓库外，或在明确忽略的 `tests/fixtures/private/`，不得被 committed tests 读取。

## 4. 确定性要求

- 默认测试完全离线；
- 不需要 Strava/Garmin/COROS Token；
- 不调用真实 API；
- 不依赖系统当前日期、随机数或时区，除非显式注入；
- Demo 使用固定 seed；
- 同一 fixture 在不同机器产生相同 Canonical 输出；
- 失败测试不得通过重试或扩大容差掩盖；
- 数值容差必须说明单位和理由。

## 5. 测试层次

### 5.1 Syntax 和静态护栏

验证：

- JavaScript 语法；
- 页面目录没有新增直接 `/api/strava-*`；
- 隐私路径没有进入 Git；
- 受保护的模块边界没有被违反；
- 文档链接和 Markdown 基础格式。

### 5.2 Unit Tests

覆盖：

```text
Schema Validation
Unit Conversion
Sport Taxonomy
Date / Timezone
Capabilities
CSV Header Mapping
FIT / TCX / GPX Mapping
Fingerprint
Identity Resolver
Merge Policy
Analysis Input Hash
Feature Flag Defaults
Service Worker Development Policy
```

Unit Test 不打开浏览器、不访问 IndexedDB 真实现、不访问网络。

### 5.3 Contract Tests

覆盖：

- CanonicalActivity；
- CanonicalStreamSet；
- Lap、Event、SourceReference；
- ImportedActivityBundle；
- Repository interface；
- Legacy Projection；
- 缺失值、string ID、单位和版本 metadata。

Contract Test 应能被所有 Connector、Decoder、Repository 实现复用。

### 5.4 Repository Tests

同一测试套件分别验证：

- Legacy Repository；
- Demo/Synthetic Repository；
- Canonical Repository。

必须验证过滤、排序、summary/detail、requested streams、missing capability 和不存在 ID。

### 5.5 Storage 和 Migration Tests

使用 `fake-indexeddb` 或等价隔离环境覆盖：

- 空库初始化；
- 重复初始化；
- 版本升级；
- migration 中断和重试；
- 事务回滚；
- quota/error 注入；
- 并发打开；
- 旧数据库不被修改；
- 删除/清空只影响显式目标。

### 5.6 Import Integration Tests

覆盖纵向路径：

```text
Synthetic Artifact
→ Decoder
→ Normalizer
→ Identity
→ Transaction
→ Repository
→ Projection
```

必须验证：

- 重复导入；
- 单 Item 失败；
- 取消；
- 重试；
- 刷新后 Job 保留；
- Worker 崩溃；
- Import Report；
- 没有半条活动。

### 5.7 Decoder Tests

每个格式有独立 fixture 和期望 Canonical 输出。

FIT 至少覆盖：

```text
Run / Bike / Pool Swim
Indoor / Outdoor
No GPS / No HR / No Power
Laps
Pause / Resume
Split Records
CRC Warning
Multiple Devices
```

TCX/GPX 覆盖 namespace、multiple tracks/laps、extensions、缺失时间和非法 XML。

### 5.8 E2E Smoke Tests

覆盖：

- 首次打开和 First-run；
- Demo；
- CSV/FIT 导入；
- 重复导入；
- 取消和 Import Report；
- Dashboard 和 Activity Detail；
- 断开 Strava；
- 离线打开；
- 创建备份、清空资料库、恢复；
- Legacy/Canonical 切换。

E2E 不使用真实账户和私人资料。

### 5.9 视觉回归

矩阵：

```text
Desktop / Mobile
Light / Dark
No Data
Summary-only
Full Streams
Missing GPS
Missing HR
Error State
```

没有自动视觉工具时，必须明确标记为人工检查，不得声称完成自动验证。

### 5.10 Security Tests

覆盖：

- XSS activity name；
- XML external entity；
- ZIP path traversal；
- ZIP bomb；
- invalid FIT header；
- huge file / huge file count；
- malformed backup；
- private data Git guard；
- 日志/诊断包隐私字段扫描。

### 5.11 Performance Tests

目标场景：

```text
5,000 / 10,000 activities
1,000-file batch
200,000-point activity
concurrent imports
worker cancellation
IndexedDB quota pressure
```

性能测试记录设备、浏览器、数据规模、指标和版本，不只记录“快/慢”。

## 6. Bug 回归规则

每个确认的 Bug：

1. 先建立最小可复现 fixture；
2.增加失败测试；
3.实施修复；
4.确认新测试通过；
5.将场景加入 Regression Matrix；
6.若涉及用户数据，补充 migration/rollback 验证。

## 7. CI 分层

建议：

```text
PR:
  npm ci
  syntax
  unit
  contracts
  privacy guard

integration/v2:
  PR suite
  repository
  storage
  import integration

release:
  integration suite
  e2e
  security
  performance sample
  regression matrix evidence
```

需要真实浏览器或耗时测试时，可以单独 job，但不得从必需 Gate 中静默移除。

## 8. 失败报告

测试无法执行时必须报告：

- 精确命令；
- 精确错误；
- 运行环境；
- 是代码问题还是环境问题；
- 哪些 Gate 因此未验证。

“未运行”与“通过”必须严格区分。
