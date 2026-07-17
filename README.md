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
                 ├─ 余额统计
                 ├─ 孩子资料
                 ├─ 课外课程
                 ├─ 上课记录
                 └─ 甜心礼品屋
```

项目没有前端框架和构建步骤。`public/` 是原生 HTML/CSS/JavaScript，`src/index.js` 同时提供 API 和静态资源入口。

## Data Model

Notion 属性名是代码契约，重命名后必须同步修改 `src/index.js`。

### 每日任务

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `任务` | Title | 任务名称 |
| `星星` | Number | 每次完成后获得的星星 |
| `说明` | Rich text | 任务说明及历史记录文案 |
| `排序` | Number | 数字越小越靠前 |

任务是固定模板，始终展示；每次点击“完成一次”都会创建一条独立星星记录。任务图标直接使用 Notion 页面的 icon，支持 emoji 和图片。

### 星星记录

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `记录` | Title | 获得或兑换记录标题 |
| `类型` | Select | `获得` / `支出` |
| `星星` | Number | 获得为正数，支出为负数 |
| `任务` | Relation | 关联每日任务 |
| `说明` | Rich text | 任务或兑换说明 |
| `时间` | Date | 记录发生时间 |
| `媒体` | Files | 兑换时拍摄的照片或视频 |
| `余额统计` | Relation | 关联唯一余额统计行 |

记录表不保存余额快照。

### 余额统计

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `统计` | Title | 唯一行标题 `多乐的星星余额` |
| `星星记录` | Relation | 双向关联全部有效星星记录 |
| `当前余额` | Rollup | 对星星记录的 `星星` 字段执行 Sum |

任务、礼物进度和兑换校验均读取此 Rollup，不在 Worker 或浏览器中重新求和。

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

### 孩子资料

数据库只保留一条有效记录：`姓名`（Title）、`头像`（Files）、`生日`（Date）、`启用`（Checkbox）。头像不会作为公开静态资源部署，只能通过授权后的 Worker 代理读取。

### 课外课程

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `课程` | Title | 课程名称 |
| Page icon | Notion icon | 课程 emoji 或图片图标 |
| `颜色` | Select | 粉色、蓝色、黄色、薄荷绿、紫色 |
| `老师` | Rich text | 默认老师 |
| `地点` | Rich text | 默认地点 |
| `默认时长` | Number | 默认分钟数 |
| `启用` | Checkbox | 是否在网页展示 |
| `排序` | Number | 展示顺序 |

### 上课记录

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `记录` | Title | `课程名 - YYYY-MM-DD` |
| `课程` | Relation | 关联课外课程 |
| `上课时间` | Date | 开始时间及可选结束时间 |
| `状态` | Status | 计划中、已完成、请假、取消、试听 |
| `时长` | Number | 实际分钟数 |
| `上课内容` | Rich text | 本节课内容 |
| `课堂表现` | Select | 很开心、认真、有进步、需要鼓励 |
| `老师点评` | Rich text | 老师或家长记录 |
| `地点` | Rich text | 当次地点 |
| `媒体` | Files | 最多 5 个课堂图片或视频 |

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/rewards` | 获取固定任务、星星记录和 Rollup 余额 |
| `GET` | `/api/gifts` | 获取已启用礼品 |
| `GET` | `/api/auth` | 获取当前设备授权状态 |
| `POST` | `/api/auth/login` | 使用家长 PIN 授权当前设备 30 天 |
| `POST` | `/api/auth/logout` | 锁定当前设备 |
| `GET` | `/api/classes?year=YYYY` | 授权后获取课程、记录及年度统计 |
| `POST` | `/api/classes` | 使用家长 PIN 新增记录及媒体 |
| `GET` | `/api/class-avatar` | 授权代理孩子头像 |
| `GET` | `/api/class-course-icon/:courseId` | 授权代理课程图片图标 |
| `GET` | `/api/class-media/:recordId/:index` | 授权代理课堂图片或视频 |
| `POST` | `/api/earn` | 完成一次任务并写入一条星星记录 |
| `POST` | `/api/spend` | 使用家长 PIN 兑换礼品，可同时上传照片或视频 |

写接口要求请求来源与 Worker 同源，并且必须携带 Worker 签发的设备授权 Cookie。兑换还会再次校验当次提交的家长 PIN。

## Environment

`wrangler.toml` 保存非敏感配置：

- `NOTION_GIFTS_DATABASE_ID`
- `NOTION_TASKS_DATABASE_ID`
- `NOTION_LEDGER_DATABASE_ID`
- `NOTION_BALANCE_DATABASE_ID`
- `NOTION_BALANCE_PAGE_ID`
- `NOTION_CHILD_PROFILE_DATABASE_ID`
- `NOTION_CHILD_PROFILE_PAGE_ID`
- `NOTION_COURSES_DATABASE_ID`
- `NOTION_CLASS_RECORDS_DATABASE_ID`
- `NOTION_VERSION`

Secret：

- `NOTION_TOKEN`
- `AUTH_PIN`
- `AUTH_SECRET`

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
npx wrangler secret put AUTH_PIN
npx wrangler secret put AUTH_SECRET
npm run deploy
```

部署后至少验证：

```bash
curl https://child.malinkang.com/api/rewards
curl https://child.malinkang.com/api/gifts
```

再打开线上页面确认固定任务、余额、媒体预览和浏览器控制台。

## Business Rules

- 时区固定为 `Asia/Shanghai`。
- 任务表是固定模板，不使用日期或完成状态。
- 同一任务每天可以完成任意多次，每次完成创建一条独立记录。
- 新设备必须通过家长 PIN 授权，签名 Cookie 有效期为 30 天。
- 所有写入要求已授权，兑换礼物每次都要重新输入家长 PIN。
- 同一来源的写入操作至少间隔 2 秒；PIN 连续错误 5 次后暂时锁定 15 分钟。
- 上课记录页、头像及课堂媒体只对已授权设备开放。
- 上课记录的年度统计只计算 `已完成` 和 `试听`。
- 媒体 URL 不返回浏览器，Worker 校验记录归属后代理文件和视频 Range 请求。
- 归档任务不能继续获得星星。
- 每条新记录必须关联唯一余额统计行。
- 余额只读取余额统计表的 `当前余额` Rollup。
- 兑换前读取最新 Rollup，余额不足时拒绝写入。
- 兑换媒体最多 5 个，单个文件最大 20 MB，仅支持图片和视频。
- 媒体上传至 Notion，不存储在浏览器或 Cloudflare。

## Voice Feedback

MiniMax 生成的固定语音位于 `public/audio/`，不需要运行时 TTS API：

- 首次读取任务后，根据今天是否已有获得记录选择“开始任务”或“继续收集星星”欢迎语。
- 欢迎语每天最多主动播放一次；浏览器阻止自动播放时，延迟到用户第一次点击。
- 完成汉字或阅读任务时播放对应语音。
- 可重复任务没有“当天最后一个任务”状态，不播放全部完成语音。
- 兑换成功和星星不足使用独立语音。
- 声音开关保存在浏览器 `localStorage`，默认音量为 55%。

语音文字、文件名和用途见 [docs/audio.md](./docs/audio.md)。

更详细的 AI 修改约束和验证流程见 [AGENTS.md](./AGENTS.md)。
