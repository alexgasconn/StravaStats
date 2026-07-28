# Fixture Policy

| 字段 | 内容 |
| --- | --- |
| Status | Proposed |
| Owner | XiChuan9 |
| Created | 2026-07-28 |
| Last updated | 2026-07-28 |
| Applies to | Tests、docs、screenshots、demo、benchmarks |

## 1. 原则

测试数据必须可审查、可重复、可授权，同时不得把用户的运动轨迹和健康信息带入 Git 历史。

默认只提交 synthetic fixture。真实资料只在仓库外用于人工验证。

## 2. 分类

| 类型 | 可以提交 | 条件 |
| --- | --- | --- |
| Synthetic JSON | 是 | 人工构造、无真实身份 |
| Synthetic FIT/TCX/GPX | 是 | 虚构用户、设备和轨迹，可解释生成方式 |
| Synthetic Strava CSV/ZIP | 是 | 所有字段虚构，不包含真实 ID |
| Redacted fixture | 需审批 | 无法合成的格式边缘情况，完成隐私和许可审查 |
| Real FIT/TCX/GPX | 否 | 仅仓库外人工验证 |
| Real Strava archive | 否 | 仅仓库外人工验证 |
| Real GPS/HR/Power stream | 否 | 仅仓库外人工验证 |
| Token、Secret、Cookie | 永远禁止 | 不得出现在测试、日志或文档 |

## 3. 仓库内目录

```text
tests/fixtures/synthetic/
```

可按格式划分：

```text
synthetic/
├── canonical/
├── strava-csv/
├── strava-zip/
├── fit/
├── tcx/
├── gpx/
└── backups/
```

`tests/fixtures/private/` 必须被 `.gitignore` 保护，并且 automated tests 不得依赖其存在。

## 4. 仓库外私有目录

建议：

```text
/Users/wangchuanliang/Documents/StravaStats-private/
├── local-data/
├── fixtures-private/
├── exports/
├── backups/
└── baseline-evidence/
```

Codex 或测试脚本不得把这些文件复制到 `tests/`、`docs/`、`public/`、`dist/` 或构建产物。

## 5. Fixture Manifest

每个 committed fixture 或 fixture 集合必须记录：

```text
Fixture ID
Classification: Synthetic / Approved Redacted
Format and version
Sport
Capabilities
Expected warnings/errors
Expected Canonical output
Generator or construction method
License/source
Privacy reviewer
Last reviewed
```

可以使用相邻 `.md`/`.json` manifest，或目录级 README。

## 6. 合成数据要求

- 姓名、邮箱、用户名和设备序列号必须虚构；
- external ID 不得来自真实平台；
- GPS 应为人工路线或完全省略；
- 如使用坐标，避免真实住宅、工作地点和固定训练路线；
- 心率、功率、踏频和配速应在合理范围，但不得复制真实用户完整曲线；
- timestamp 使用固定日期和 timezone；
- Demo seed 固定；
- 损坏文件应由脚本从 synthetic source 生成，避免来源不明的二进制。

## 7. Redacted fixture 审批

只有无法合理合成的格式兼容问题才允许使用 redacted fixture。提交前必须：

1. 说明为什么 synthetic fixture 不足；
2.移除身份、GPS、设备序列号和平台 ID；
3.裁剪到重现问题的最小内容；
4.记录来源和使用许可；
5.由项目负责人检查 diff 和二进制 metadata；
6.在 manifest 标记 `Approved Redacted`。

## 8. 基线截图

截图可能包含姓名、活动时间、GPS、心率、功率和固定路线。

- 仓库内只提交 Demo/synthetic 或完整脱敏截图；
- 真实用户基线截图放在仓库外 `baseline-evidence/`；
- 仓库内 `baseline-summary.md` 只记录环境、commit、页面状态和非识别性结果；
- 不得通过模糊一个小区域就假定整张截图安全。

## 9. Git 检查

PR-00 应建立隐私路径和扩展名护栏，但不能全局忽略所有 `.fit/.tcx/.gpx`，因为 synthetic fixture 需要显式提交。

提交 fixture 必须使用精确路径：

```bash
git add tests/fixtures/synthetic/<fixture>
```

禁止：

```bash
git add .
```

提交前检查文件类型、大小、文本和二进制 metadata。

## 10. 删除与泄漏响应

若真实资料进入 Git：

1. 立即停止 push/merge；
2.识别是否已经进入远端历史；
3.撤销可能暴露的 Token/Secret；
4.按 Git 历史清理流程移除敏感对象；
5.重新审查构建产物和 CI artifacts；
6.记录事件和改进 guard；
7.不要只用后续 commit 删除文件，因为旧历史仍然存在。
