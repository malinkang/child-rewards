# 奇奇学学习记录补录与每日同步

- 日期：2026-09-21
- 状态：planned

## 目标与范围

先补录奇奇学当前全部可读取的学习明细，再实现 GitHub Actions 每日同步。学习明细放在「孩子」页面下的「学习记录」数据库，保留每次阅读，不自动判断读完或掌握，不自动发放星星；历史人工星星记录不修改。

- 读取经过验证的 summaryList 接口，完整分页，每个来源记录 ID 对应一行，同一天多次学习分别保留。
- 保存书名、北京时间起止时间、会话时长、来源及来源 ID；不保存令牌、设备信息、AI 报告或孩子姓名副本。
- 先用 Notion 连接器补录并按来源 ID 核对全量数据。
- GitHub Actions 每天北京时间 06:17 运行，可手动运行和 dry-run。源会话 Cookie 放 GitHub Secrets，Notion Token 继续只保留在 Cloudflare Secrets。
- 增加限定用途的 Worker 同步入口，使用独立机器凭证和并发去重；不改变现有浏览器设备鉴权或余额规则。
- 同步错误、会话过期和不完整分页必须明确失败，日志只输出数量和固定错误码。
- 补充凭证更新说明、README、AGENTS、相关测试，配置并验证真实 workflow 与重复运行。

## 实施步骤

1. 建立学习记录数据库，先写入并核对 34 天、41 条现有记录。
2. 编写源数据分页与标准化脚本、Worker 导入逻辑和 GitHub Actions 工作流。
3. 测试多条同日记录、北京时间、分页失败、登录过期、字段验证、鉴权、去重、并发和写入结果不确定时的恢复。
4. 配置 Secrets，部署 Worker，推送并运行工作流，验证再次运行没有新增重复记录。
5. 更新计划完成状态，创建独立完成提交并推送。

## 验收与验证

- Notion 来源 ID 集合与源记录一致，日期和起止时间正确，历史星星和 Rollup 余额不变。
- 缺失/无效机器凭证不能写入，源 Cookie 不发送到 Worker，Notion Token 不进入 GitHub。
- 重复及并发运行不会重复创建已同步记录；不确定的创建结果优先核对，禁止盲目重试 POST。
- `node --check src/index.js`、`node --check public/app.js`、`git diff --check`、`npm test`、`npm run check` 通过。
- 线上 rewards/gifts 正常，workflow 首次与再次运行成功，不创建临时真实星星记录。
