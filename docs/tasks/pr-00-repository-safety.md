# PR-00：Repository Safety

## Metadata

| 字段 | 内容 |
| --- | --- |
| Status | Ready for independent review |
| Base branch | `integration/v2` |
| Feature branch | `codex/v2/repo-safety` |
| Worktree | `/Users/wangchuanliang/Documents/StravaStats-worktrees/repo-safety` |
| Owner | XiChuan9 |
| Reviewer | 独立 Codex 线程 + XiChuan9 |
| Related PRD | Sections 2.3、4.1、8.1、9.3 |
| Related plan | Sprint 0 / PR 00 |
| Related ADRs | None required; must not define Canonical Schema |
| Dependencies | TASK-0000 merged；baseline/branches/worktree prepared |
| Data migration | None |
| Runtime behavior | Existing product behavior unchanged |
| Pull request | [#3](https://github.com/XiChuan9/StravaStats/pull/3) |

## 1. Goal

为后续 StravaStats v2 迁移建立最小工程护栏：隐私文件保护、项目级 Agent 规则、可工作的测试入口、最小 CI、无行为 Feature Flag 骨架和稳定的本地开发 Service Worker 策略。

本 PR 不实现任何 V2 数据架构。

## 2. Why now

当前仓库：

- 没有 `npm test`；
- 没有 CI；
- 没有项目级 `AGENTS.md`；
- `.gitignore` 尚未专门保护私人运动资料目录；
- localhost Service Worker 可能让不同 worktree 运行旧资源；
- 尚无 Feature Flag 骨架；
- 后续 PR 的 Release Gate 无法实际执行。

在这些护栏建立前，不应启动 Canonical、IndexedDB v2 或 Decoder 开发。

## 3. Investigation questions

调查阶段只读回答：

1. 当前测试、CI、`.gitignore` 和开发环境事实是什么？
2. PR-00 的最小修改集合是什么？
3. Service Worker 在 localhost 和多个端口/worktree 下如何注册、更新和清理？
4. `node:test` 与 Vitest 哪个更适合当前无 bundler ES Module 项目？
5. IndexedDB 测试是否应在本 PR 引入 `fake-indexeddb`，还是延后 PR-05？
6. Feature Flag 配置如何保持纯函数和可测试？
7. Demo seed 当前是否确定性？
8.哪些本地路径、扩展名和生成物可能误提交？
9. GitHub Actions 使用哪个 Node 版本？
10.是否需要将 syntax checker 纳入 `npm test`，还是保持独立 Gate？
11.哪些决定需要负责人批准后才能实施？

调查已于 2026-07-28 完成，并在负责人批准后进入实施。

## 4. Confirmed current-state facts

- `package.json` 当前只有 `dev` 和 `check:syntax`；
- 语法检查当前覆盖约 90 个文件；
- 无 `.github/workflows`；
- 无 `AGENTS.md`；
- 应用是 Vanilla JavaScript + native ES modules；
- 本地服务由 `scripts/local-dev-server.mjs` 启动；
- 当前 PWA 使用 `sw.js`；
- 真实运动资料不应进入仓库；
- Canonical/Storage/Repository 决策属于后续 PR。

调查应重新验证这些事实，不能只依赖本文。

## 5. Decisions required before implementation

2026-07-28 已批准：

- 使用内置 `node:test`，不引入测试框架依赖；
- CI 使用 Node 24 LTS；
- localhost 默认注销现有 Worker 并清理本应用 Cache，可用
  `?enable-sw=1` 显式启用；
- Feature Flag 使用纯函数解析显式 runtime override，默认全部 Legacy；
- `fake-indexeddb` 延后到 PR-05；
- Demo activity generator 使用固定 seed 和显式 UTC-day reference date；
- 隐私 guard 使用本地脚本，并由 CI 执行；
- syntax、privacy 和 unit tests 保持独立 Gate。

## 6. In scope

1. `.gitignore` 保护：
   - `/local-data/`；
   - `/tests/fixtures/private/`；
   - `/.env.worktree`；
   - `/worktree.local.json`；
   -明确的私人导出、备份和临时目录；
2. 根目录 `AGENTS.md`；
3. 测试目录建立时增加 `tests/AGENTS.md`；
4. GitHub Actions 最小 CI；
5. `package.json` 中可工作的 `npm test`；
6.少量确定性、无网络、无 Token 测试；
7. `js/app/feature-flags.js`；
8.默认值：

```text
dataRepositoryMode = legacy
localImportEnabled = false
canonicalShadowWriteEnabled = false
```

9. localhost Service Worker 策略；
10.与 Service Worker 策略相关的纯函数测试；
11.必要的 `scripts/` 隐私/测试护栏；
12. `.github/pull_request_template.md`；
13.更新当前 Task Brief 和相关工程文档。

## 7. Out of scope

- CanonicalActivity/Streams Contract；
- IndexedDB v2；
- Legacy Cache Rescue；
- FIT/TCX/GPX/CSV/ZIP Decoder；
- Repository 迁移；
- 页面视觉；
- 认证数据生命周期；
- Strava API 行为；
- 现有分析算法；
- Run Plus/NSM 重构；
- 新的 UI 框架、TypeScript 或 bundler；
- 完整 E2E/视觉回归系统；
- 真实运动数据测试。

## 8. Allowed files

```text
.gitignore
AGENTS.md
.github/**
package.json
package-lock.json
scripts/**
tests/**
sw.js
index.html（仅 Service Worker 注册边界确有需要时）
js/app/feature-flags.js
js/app/*（仅经调查批准的 Service Worker 注册纯函数边界）
js/demo/generator.js（仅确定性 seed/reference date）
js/demo/index.js（仅确定性 demo token 和 runtime reference date）
docs/baseline/baseline-summary.md
docs/tasks/0000-v2-documentation-baseline.md
docs/engineering/**
docs/testing/**
docs/tasks/pr-00-repository-safety.md
```

实际实施前应把允许文件缩小到调查确认的最小集合。

## 9. Prohibited files and operations

```text
js/data/**
js/analysis/**
js/tabs/run-plus.js
styles/**
api/**
Legacy IndexedDB schema
tests/fixtures/private/**
仓库外私人资料
```

禁止：

- `git add .`；
- 修改 `main` 或 `integration/v2`；
- 切换/删除分支；
- amend/force-push 共享历史；
- 合并 PR；
- 访问真实运动文件；
- 全局忽略所有 `.fit/.tcx/.gpx`，从而阻止 future synthetic fixtures；
- 把 `npm test` 配成永远成功的空命令；
- 声称未执行的浏览器验证已经通过。

## 10. Expected outputs

### Feature Flags

提供可导入、可测试的纯配置接口。默认值不得改变现有运行路径。

### Test command

```bash
npm test
```

必须真实发现并执行测试；没有测试时不应假成功。

### CI

至少执行：

```text
npm ci
npm run check:syntax
npm run check:privacy
npm test
```

不需要 Token，不调用网络数据源。

### AGENTS.md

至少规定：

- 项目目标和事实来源；
- 非破坏性 migration；
- 隐私；
- Git/worktree；
- 范围控制；
- 必需检查；
- 最终报告。

Task Brief 不得凌驾于 Accepted ADR 和数据安全约束。

分层规则按以下阶段创建：

| 文件 | 创建阶段 |
| --- | --- |
| `AGENTS.md` | 本 PR |
| `tests/AGENTS.md` | 本 PR，随测试目录建立 |
| `js/data/AGENTS.md` | PR-02 Canonical Contracts |
| `js/tabs/AGENTS.md` | PR-04A Consumer Migration 前 |
| `js/analysis/AGENTS.md` | 正式修改分析算法前 |

本 PR 不创建尚不存在或职责尚未冻结的 `js/data/AGENTS.md`，也不提前为后续目录写空泛覆盖规则。

## 11. Acceptance criteria

- [x] `npm test` 存在且实际执行测试；
- [x] CI 从干净 checkout 运行；
- [x] 测试无网络、Token 和私人 fixture；
- [x] Feature Flag 默认全部保持 Legacy 行为；
- [x] Feature Flag 有单元测试；
- [x] localhost 不被旧 Service Worker 静默干扰；
- [x] 生产 Service Worker/PWA 注册路径保持不变；
- [x] 隐私目录被保护；
- [x] synthetic fixture 仍可显式提交；
- [x] PR Template 要求测试、migration、privacy 和 rollback；
- [x] `AGENTS.md` 与正式 docs 一致；
- [x] `tests/AGENTS.md` 约束 synthetic/private fixture 和无网络测试；
- [x] 分层 `AGENTS.md` 后续排期已记录；
- [x] Dashboard、Run、Bike、Swim、Run Plus、NSM 和既有 Activity Detail 行为不变；
- [x] 没有 Canonical、IndexedDB 或 Decoder 代码。

## 12. Required automated checks

```bash
npm ci
npm run check:syntax
npm test
git diff --check
```

如增加隐私 guard：

```bash
npm run check:privacy
```

精确命令由调查后批准的实现决定。

## 13. Manual verification

- 本地服务器可以启动；
- localhost 的 Service Worker 行为符合批准方案；
- 生产条件下仍可注册 PWA；
- 主页面视觉和导航未变化；
- Feature Flag 默认没有显示新 UI；
- 不同端口/worktree 不读取明显错误的旧 bundle；
- 无 Strava Token 的 CI 不失败。

由于真实 Strava 开发者登录受订阅条件阻断，本 PR 使用无账号 Demo
自动冒烟替代主要页面人工验证。真实 OAuth、真实 Activity Detail 和
Disconnect/Logout 必须明确记录为未验证，不得伪装成 Pass。

自动 Demo 页面：

```text
Dashboard
Activities
Run
Run Plus
NSM
Bike
Swim
Settings
Activity Detail（保持 tagged baseline 的 401 已知限制）
```

## 14. Privacy and security impact

本 PR 提升 Git/CI 隐私防护，不处理用户活动。不得将私人 fixture 用作 guard 测试。

需要确认 `.gitignore`、PR Template、AGENTS 和 CI guard 互相一致。

## 15. Migration impact

无用户数据 migration。Feature Flag 只建立默认 Legacy 骨架；Service Worker 变化可能影响本地缓存生命周期，因此必须单独记录和人工验证。

## 16. Rollback

按逻辑提交分别 revert：

1. Test/CI；
2. Feature Flag；
3. Service Worker development policy；
4. AGENTS/PR Template/ignore。

回滚说明必须回答：

- 是否需要恢复 `package-lock.json`；
- 是否需要 unregister Service Worker；
- 是否需要清理 localhost cache；
- 是否影响生产 PWA；
- 是否影响用户数据。

本 PR 不应修改 IndexedDB 或删除浏览器数据。

## 17. Independent review checklist

- [x]没有业务功能或架构越界；
- [x] `npm test` 不是空壳；
- [x] CI 不需要秘密凭据；
- [x] Service Worker 生产行为未改变；
- [x] Feature Flag 默认 Legacy；
- [x]没有真实数据；
- [x] `.gitignore` 没有阻止 synthetic fixture；
- [x] AGENTS 事实优先级正确；
- [x]回滚可执行；
- [x]文档和实际脚本一致。

## 18. Completion evidence

```text
Investigation report: Completed 2026-07-28
Approved decisions: Section 5
Implementation commits: See PR #3 commit history
Pull request: https://github.com/XiChuan9/StravaStats/pull/3
CI: Pass — https://github.com/XiChuan9/StravaStats/actions/runs/30336650344
Tests: npm test, 13/13 pass
Checks: npm ci; syntax 96 files; privacy; diff; CI YAML parse
Manual verification: Automated Demo smoke passed for Dashboard, Run, Run Plus,
  NSM, Bike, Swim, Activities and Settings; no browser warning/error
Reviewer: Independent Codex review completed; P1 demo-date finding resolved
Known limitations: Real OAuth unavailable; Demo Activity Detail returns 401;
  browser automation surface does not expose Service Worker registration state
Follow-up: PR-01 Legacy Cache Rescue
```
