# 奇奇学学习记录每日同步

GitHub Actions 每天北京时间 **06:17**（UTC 前一天 22:17）读取奇奇学学习记录，然后逐条调用 Cloudflare Worker 写入 Notion。GitHub 的计划任务可能延迟，因此这不是精确到分钟的提醒。

## 数据与行为

- 目的地：[孩子 → 星星记录](https://www.notion.so/39a86019c92c8175a929f262bc580584)。首次补录 2026-07-16 至 2026-09-18 的 34 天、41 次阅读：原有 3 条同日人工奖励补充书名和来源 ID，其余新增 38 条。
- 源接口：`GET https://m.qiqixue.com/qqx/parentCenter/growth/summaryList`，使用 `pageNum` 和 `pageSize` 分页；`total` 是日期数，一天可能有多条卡片。
- 每次读取全部历史分页，所有分页校验完成后才开始导入。补上迟到的点读笔上传记录；不会因只取昨天而漏数据。
- 起止时间固定按北京时间解释，在 `备注` 保存原始起止时间及秒数，`时间` 为开始时间。原有人工记录保留原时间，首次连接器创建的日期精度为分钟。
- 按 `qiqixue:<accountId>:<recordId>` 去重，同一天读两次保留两行，同一本书另一次阅读仍可新增。
- 每次阅读按关联任务当前星星值发放（目前 1 星星），包括短会话；不自动评价掌握程度。每条新增均关联余额统计，余额继续只读 Notion Rollup。
- 脚本只新增缺失的星星记录，不覆盖已同步说明或人工修改。遇到同日未标记来源的人工牛津树奖励时停止，核对后补上来源 ID 再运行。已被去重器识别过的记录归档后不会被重新创建。
- 不同步 AI 报告、孩子姓名、手机、设备、音视频或签名媒体地址；Actions 不上传原始数据 artifact。

## 配置

Cloudflare Secrets：

- `NOTION_TOKEN`：沿用已有 Token，只存在于 Cloudflare。
- `QIQIXUE_SYNC_TOKEN`：随机生成至少 32 字符的专用同步凭证，仅用于该接口；同值配置在 GitHub Secrets。

GitHub Actions Secrets：

- `QIQIXUE_COOKIE`：已登录的奇奇学 summaryList 请求完整 Cookie。Reqable HAR 的 HTTP/2 请求可能将 Cookie 拆成多行，必须用 `; ` 合并所有 Cookie 头。
- `QIQIXUE_SYNC_TOKEN`：与 Cloudflare 同名 Secret 一致。

`wrangler.toml` 保存 `NOTION_QIQIXUE_TASK_ID` 和 `QIQIXUE_IMPORTS` Durable Object 绑定；沿用现有星星记录和任务数据库。配置的阅读任务必须保持有效，归档或更换任务时需更新任务 ID。

Secret 通过 CLI 的交互输入或 stdin 设置，不放在命令行参数、仓库、日志或截图中：

```bash
npx wrangler secret put QIQIXUE_SYNC_TOKEN
gh secret set QIQIXUE_SYNC_TOKEN --repo malinkang/child-rewards
gh secret set QIQIXUE_COOKIE --repo malinkang/child-rewards
npm run deploy
```

## 运行与验证

在 GitHub Actions 的 **Sync Qiqixue learning records** 工作流中手动运行。默认 `dry_run=true`，只读取源数据和核对 Notion；关闭后新增缺失记录。计划任务自动使用正式导入模式。所有运行使用同一 concurrency group，正在执行时后续任务排队。

```bash
gh workflow run sync-qiqixue.yml -f dry_run=true
gh workflow run sync-qiqixue.yml -f dry_run=false
```

日志与执行摘要只提供读取数、已存在数、拟新增/新增数及固定错误码；没有学习明细或凭证。正式运行后再执行一次应为 `created=0`。

## 去重与故障处理

机器请求为 `POST /api/sync/qiqixue`，Authorization 使用 `Bearer QIQIXUE_SYNC_TOKEN`，JSON 为 `{ record: { sourceId, book, start, end, seconds, wifiPen }, dryRun: boolean }`。接口不接受任意 Notion 属性、库 ID 或星星数。

每个来源记录分配一个 Durable Object，串行执行 Notion 核对及新增。存储只含 Notion 页面 ID 或未确认的创建意图；星星记录仍以 Notion 为准。写入成功前记录意图，超时、断线或 Notion 5xx 后不会盲目再次创建。下次运行查询到已存在记录即可恢复。

若收到 `SYNC_RECONCILIATION_REQUIRED`，说明某次写入结果不确定且仍未查到记录。先在 Notion 核对该运行涉及的数据，并检查 Notion 服务状态；待记录可查询后重跑。若确认根本没有写入，可在核对任务、星星及余额关联后手动补录这一条并填写相同来源 ID，再运行即可恢复；代码不自动清除 pending，也不提供公开重置接口。

其他常见错误：

- GitHub 作业没有任何执行步骤，提示付款失败或需要提高支出额度：先在 GitHub 账户的 Billing & plans 中处理计费限制，之后手动重跑；此时脚本尚未执行，调整 Cookie 或 Worker 无法解决。
- 来源登录失效：重新在奇奇学登录，导出一个成功的学习记录请求，更新 `QIQIXUE_COOKIE` 后手动运行。当前抓包未提供有效期或可靠的刷新令牌，脚本不自动发送验证码或重新登录。
- `SYNC_UNAUTHORIZED`：GitHub 与 Cloudflare 同步 Secret 不一致。
- `NOTION_READ_FAILED`：检查 Notion integration 对星星记录数据库的权限、Token、服务可用性。
- `MANUAL_RECORD_REVIEW_REQUIRED`：同日已有未关联来源 ID 的人工牛津树奖励。核对并给对应记录补上来源 ID 和书名后重跑，不能简单忽略冲突再加星星。
- `TASK_INVALID`：配置的任务已归档、不属于任务数据库、名称为空或星星值无效。
- `SOURCE_CONFLICT`：同一来源 ID 有多行或已知页面被移动/改了来源 ID，需要人工核对，不自动删除记录。
- 分页或字段变化：整个源读取失败，修复适配后重跑，不把异常当作“今天没有学习”。

工作流失败会标记为红色；是否邮件/应用通知遵循用户自己的 GitHub Actions 通知设置。
