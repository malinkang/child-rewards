# Child Rewards

一个面向孩子的星星奖励 Web 应用。前端由 Cloudflare Worker 静态资源托管，任务、星星记录、礼品及媒体文件统一保存在 Notion。

- 线上地址：<https://child.malinkang.com>
- GitHub：<https://github.com/malinkang/child-rewards>

## Architecture

```text
Browser
  ├─ public/index.html + styles.css + app.js
  └─ /api/*
       └─ Cloudflare Worker (src/index.js)
            └─ Notion API
                 ├─ 每日任务
                 ├─ 星星记录
                 └─ 甜心礼品屋
```

项目没有前端框架和构建步骤。`public/` 是原生 HTML/CSS/JavaScript，`src/index.js` 同时提供 API 和静态资源入口。

## Data Model

Notion 属性名是代码契约，重命名后必须同步修改 `src/index.js`。

### 每日任务

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `任务` | Title | 任务名称 |
| `星星` | Number | 完成后获得的星星 |
| `说明` | Rich text | 任务说明及历史记录文案 |
| `日期` | Date | 仅加载北京时间当天的任务 |
| `状态` | Status | `Not started` / `Done`，保存任务对勾 |
| `排序` | Number | 数字越小越靠前 |

任务图标直接使用 Notion 页面的 icon，支持 emoji 和图片。

### 星星记录

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `记录` | Title | 获得或兑换记录标题 |
| `类型` | Select | `获得` / `支出` |
| `星星` | Number | 获得为正数，支出为负数 |
| `任务` | Relation | 关联每日任务 |
| `说明` | Rich text | 任务或兑换说明 |
| `时间` | Date | 记录发生时间 |
| `余额` | Number | 创建记录时的余额快照 |
| `媒体` | Files | 兑换时拍摄的照片或视频 |

当前余额以所有有效记录的 `星星` 字段求和为准，不依赖 `余额` 快照。

### 甜心礼品屋

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `礼品` | Title | 礼品名称 |
| `星星` | Number | 兑换价格 |
| `分类` | Select | 礼品分类 |
| `媒体` | Files | 礼品图片或视频 |
| `启用` | Checkbox | 只展示启用的礼品 |
| `说明` | Rich text | 礼品说明 |
| `排序` | Number | 数字越小越靠前 |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/rewards` | 获取北京时间当天任务、星星记录和余额 |
| `GET` | `/api/gifts` | 获取已启用礼品 |
| `POST` | `/api/earn` | 完成当天任务、写入星星记录并更新 Status |
| `POST` | `/api/spend` | 兑换礼品，可同时上传照片或视频 |

写接口要求请求来源与 Worker 同源。Notion Token 只存在于 Worker Secret 中，不能放入前端代码、Git 或普通环境变量。

## Environment

`wrangler.toml` 保存非敏感配置：

- `NOTION_GIFTS_DATABASE_ID`
- `NOTION_TASKS_DATABASE_ID`
- `NOTION_LEDGER_DATABASE_ID`
- `NOTION_TASK_DONE_STATUS_ID`
- `NOTION_VERSION`

Secret：

- `NOTION_TOKEN`

## Development

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地 Notion Token
npm run dev
```

默认由 Wrangler 提供本地地址。修改后执行：

```bash
npm run check
```

## Deployment

```bash
npx wrangler secret put NOTION_TOKEN
npm run deploy
```

部署后至少验证：

```bash
curl https://child.malinkang.com/api/rewards
curl https://child.malinkang.com/api/gifts
```

再打开线上页面确认当天任务、余额、媒体预览和浏览器控制台。

## Business Rules

- 时区固定为 `Asia/Shanghai`。
- 只显示 `日期` 为北京时间当天的任务。
- 对勾以 Notion `状态` 为准，完成任务后写为 `Done`。
- 同一任务同一天只能获得一次星星。
- 归档任务不能继续获得星星。
- 兑换前由 Worker 重新计算余额，余额不足时拒绝写入。
- 兑换媒体最多 5 个，单个文件最大 20 MB，仅支持图片和视频。
- 媒体上传至 Notion，不存储在浏览器或 Cloudflare。

## Voice Feedback

MiniMax 生成的固定语音位于 `public/audio/`，不需要运行时 TTS API：

- 首次读取任务后，根据“未开始 / 部分完成 / 全部完成”选择欢迎语。
- 欢迎语每天最多主动播放一次；浏览器阻止自动播放时，延迟到用户第一次点击。
- 完成汉字或阅读任务时播放对应语音。
- 完成当天最后一个任务时只播放“全部完成”，避免连续播报。
- 兑换成功和星星不足使用独立语音。
- 声音开关保存在浏览器 `localStorage`，默认音量为 55%。

语音文字、文件名和用途见 [docs/audio.md](./docs/audio.md)。

## Live2D Helper

页面右下角的小助手使用 Live2D 官方免费示例模型 Wanko。点击会播放 `TapBody` 动作和已有的鼓励语音，拖动后会在浏览器本地保存位置。运行库和模型的许可证保存在 `public/live2d/licenses/`。

更详细的 AI 修改约束和验证流程见 [AGENTS.md](./AGENTS.md)。
