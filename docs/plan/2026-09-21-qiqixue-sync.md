# 奇奇学学习记录补录与每日同步

- 日期：2026-09-21
- 状态：in_progress

## 目标与范围

先补录奇奇学当前全部可读取的学习明细，再实现 GitHub Actions 每日同步。按照用户明确更正，所有阅读补充到现有「星星记录」，不另建数据库。每次阅读关联当前有效的牛津树任务，按任务星星值发放；保留同日多次记录，不描述掌握程度。

- 读取经过验证的 summaryList 接口，完整分页，每个来源记录 ID 对应一行，同一天多次学习分别保留。
- 保存书名、北京时间起止时间、会话时长、来源及来源 ID；不保存令牌、设备信息、AI 报告或孩子姓名副本。
- 先用 Notion 连接器补录并按来源 ID 核对全量数据。
- GitHub Actions 每天北京时间 06:17 运行，可手动运行和 dry-run。源会话 Cookie 放 GitHub Secrets，Notion Token 继续只保留在 Cloudflare Secrets。
- 增加限定用途的 Worker 同步入口，使用独立机器凭证和并发去重；不改变现有浏览器设备鉴权或余额规则。
- 同步错误、会话过期和不完整分页必须明确失败，日志只输出数量和固定错误码。
- 补充凭证更新说明、README、AGENTS、相关测试，配置并验证真实 workflow 与重复运行。

## 实施步骤

1. 核对已有星星记录，为同日人工奖励补充书名及来源 ID，新增缺失阅读；移除误建的学习记录数据库。
2. 编写源数据分页与标准化脚本、Worker 导入逻辑和 GitHub Actions 工作流。
3. 测试多条同日记录、北京时间、分页失败、登录过期、字段验证、鉴权、去重、并发和写入结果不确定时的恢复。
4. 配置 Secrets，部署 Worker，推送并运行工作流，验证再次运行没有新增重复记录。
5. 更新计划完成状态，创建独立完成提交并推送。

## 验收与验证

- Notion 来源 ID 集合与源记录一致，源起止时间在备注中保留，已有奖励不重复发放；新增星星与当前任务值一致，Rollup 正确更新。
- 缺失/无效机器凭证不能写入，源 Cookie 不发送到 Worker，Notion Token 不进入 GitHub。
- 重复及并发运行不会重复创建已同步记录；不确定的创建结果优先核对，禁止盲目重试 POST。
- `node --check src/index.js`、`node --check public/app.js`、`git diff --check`、`npm test`、`npm run check` 通过。
- 线上 rewards/gifts 正常，真实源数据再次执行不创建重复星星记录，GitHub workflow 配置生效。

## 进展

- 已按用户更正移除误建的「学习记录」数据库，并确认它不再出现在「孩子」页面。
- 已核对 34 天、41 次阅读，原有 3 条同日人工奖励补充书名及来源 ID，新增 38 条；账本共 95 条，Notion Rollup 余额从 20 变为 58。来源 ID 集合与接口一致，原始起止时间和秒数保存在备注。
- 已实现来源分页、校验、机器鉴权、Durable Object 去重、手工奖励冲突检查及每日工作流；Cloudflare 与 GitHub Secrets 已配置，Notion Token 仍仅保留在 Cloudflare。
- 35 项测试、语法、diff 和 Wrangler 构建检查通过；本地 Wrangler 运行时联调发现并修复 `redirect: error` 不受支持的问题，Worker 改为不跟随重定向的 `manual`。
- 已部署 Worker。真实数据 dry-run 与正式运行均返回 34 天、41 条、已存在 41 条、新增 0 条。网页显示余额 58，桌面 1280px 与手机 390px 均无横向溢出，浏览器无错误，rewards/gifts 正常。
- GitHub 验证运行：https://github.com/malinkang/child-rewards/actions/runs/35590705331 。运行器未启动，GitHub 报告账户付款失败或支出限额需提高；没有执行任何脚本步骤。计划保持 in_progress，待用户处理 GitHub Billing & plans 后完成 GitHub 端运行验证，再创建完成提交。
