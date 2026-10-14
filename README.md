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
                 ├─ 诗文馆
                 ├─ 多乐作品墙
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
| `说明` | Rich text | 任务、兑换或学习备注；在“闪亮成长册”中单独展示 |
| `时间` | Date | 记录发生时间 |
| `媒体` | Files | 兑换时拍摄的照片或视频 |
| `余额统计` | Relation | 关联唯一余额统计行 |

记录表不保存余额快照。

### 奇奇学阅读补录

奇奇学每次阅读保存到现有「星星记录」，关联「读 1本牛津树」任务及余额统计。`来源 ID`（Rich text）用 `qiqixue:<accountId>:<recordId>` 去重，`备注`（Rich text）保留源起止时间和会话秒数，`说明` 只显示「阅读牛津树：书名」。

同日多次阅读分别保留，每条新增按任务当前星星值发放（目前 1 星星），并进入已有首页和热力图。历史同日人工记录先核对、补充来源 ID，避免重复发放。没有设置时长门槛，短会话也补录；秒数只表示源起止时间差，不代表掌握程度。

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
| `媒体` | Files | 最多 5 个课堂图片或视频，应用不限制单文件大小 |

### 诗文馆

只读诗文库，来源为 Notion 数据库 `1b586019-c92c-8364-a021-018c2b927b9a`（通过 `NOTION_POETRY_DATABASE_ID` 配置）。应用不写入该表，也不发放星星。

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `标题` | Title | 诗文名称 |
| `原文` | Rich text | 原文，页面按原始换行展示 |
| `学段` | Select | 小学、初中、高中；未标注的行显示为「未标注」 |
| `年级` | Select | 教材顺序，如 `一年级上册`、`高中选择性必修中册` |
| `板块` | Select | 所属板块 |
| `背诵状态` | Select / Status | 包含 `复习中`；`已掌握` 单独计入进度 |
| `计划周次` | Rich text | 例如 `新学第 3 周`、`复习`、`中学长线` |
| `朝代` | Select | 朝代 |
| `类型` | Multi-select | 体裁标签，页面展示全部选项 |
| `链接` | URL | 仅接受 HTTP(S) 来源链接 |
| `音频` | Files | 可选朗读音频，仅接受 HTTP(S) URL |
| `作者` | Relation | 关联作者页，只读取页面标题 |
| `序号` | Number | 升序展示，缺省值排到最后 |

### 多乐作品墙

公开只读的画作墙，来源为 Notion 数据库「多乐作品墙」（通过 `NOTION_ARTWORKS_DATABASE_ID` 配置）。应用不写入该表，也不发放星星。

| 属性 | 类型 | 用途 |
| --- | --- | --- |
| `作品` | Title | 作品名称，如 `多乐作品 01` |
| `序号` | Number | 升序展示，缺省或无效值排到最后 |
| `描述` | Rich text | 多乐的讲述；只在点击放大后的视图中展示 |
| `上传时间` | Date | 上传时间；只在放大视图中按 `Asia/Shanghai` 显示 |
| `图片` | Files | 作品图片；页面正文没有 image 区块时才使用的回退来源 |
| `音频` | Files | 讲述音频；页面正文没有 audio 区块时才使用的回退来源，不自动播放 |

作品正文区块是媒体的事实来源：每个页面的第一个 `image` 区块和第一个 `audio` 区块优先，`图片`、`音频` 属性只作为 HTTP(S) 回退（部分作品在上传后重新修正过旋转方向）。媒体 URL 不返回浏览器，统一由 Worker 代理。

墙面的缩略卡片只展示画作本身，不叠加任何文字或标记；作品名同时写入图片 `alt` 与按钮无障碍标签。作品名、上传日期（`Asia/Shanghai`）、多乐的 `描述` 和讲述音频都只在放大视图里显示。放大视图左右两侧的切换按钮与画框之间保留可见间距。

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/rewards` | 获取固定任务、星星记录和 Rollup 余额 |
| `GET` | `/api/gifts` | 获取已启用礼品 |
| `GET` | `/api/poetry` | 获取全部诗文、统计及筛选所需字段（公开只读，缓存 60 秒） |
| `GET` | `/api/poetry/:recordId/content` | 按需获取单首诗文的原文、译文与赏析（展开卡片时按需请求，公开缓存） |
| `GET` | `/api/artworks` | 获取全部作品、讲述、日期及同源媒体路径（公开只读，缓存 60 秒） |
| `GET` | `/api/artwork-media/:pageId/(image\|audio)` | 公开代理作品图片或讲述音频，校验归属后转发并保留 Range |
| `GET` | `/api/auth` | 获取当前设备授权状态 |
| `POST` | `/api/auth/login` | 使用家长 PIN 授权当前设备 30 天 |
| `POST` | `/api/auth/logout` | 锁定当前设备 |
| `GET` | `/api/classes?year=YYYY` | 授权后获取课程、记录及年度统计 |
| `POST` | `/api/classes` | 已授权设备使用已上传 file ID 新增完整记录 |
| `PATCH` | `/api/classes/:recordId` | 已授权设备修改记录字段并保留现有媒体 |
| `POST` | `/api/class-uploads/start` | 选中文件后立即创建签名分片上传会话 |
| `POST` | `/api/class-uploads/:uploadId/parts/:partNumber` | 上传一个 10 MiB 文件分片 |
| `POST` | `/api/class-uploads/:uploadId/complete` | 完成上传并返回签名 file ID 凭证 |
| `GET` | `/api/class-avatar` | 授权代理孩子头像 |
| `GET` | `/api/class-course-icon/:courseId` | 授权代理课程图片图标 |
| `GET` | `/api/class-media/:recordId/:index` | 授权代理课堂图片或视频 |
| `POST` | `/api/earn` | 完成一次任务并写入一条星星记录 |
| `POST` | `/api/spend` | 使用家长 PIN 兑换礼品，可同时上传照片或视频 |
| `POST` | `/api/sync/qiqixue` | 独立机器凭证导入单条学习明细，支持 dry-run 和持久去重 |

浏览器写接口要求请求来源与 Worker 同源，并且必须携带 Worker 签发的设备授权 Cookie。兑换还会再次校验当次提交的家长 PIN。奇奇学同步入口是独立机器接口，拒绝带 Origin 的请求，仅接受专用 Bearer token，详见 [同步说明](docs/qiqixue-sync.md)。

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
- `NOTION_POETRY_DATABASE_ID`
- `NOTION_ARTWORKS_DATABASE_ID`
- `NOTION_ARTWORKS_DATA_SOURCE_ID`
- `NOTION_QIQIXUE_TASK_ID`
- `NOTION_VERSION`

Secret：

- `NOTION_TOKEN`
- `NOTION_ARTWORKS_TOKEN`（可选，仅覆盖作品墙的 Notion 读取）
- `AUTH_PIN`
- `AUTH_SECRET`
- `QIQIXUE_SYNC_TOKEN`（仅授权学习导入，另存于 GitHub Actions Secrets）

奇奇学每日同步由 `.github/workflows/sync-qiqixue.yml` 在北京时间 06:17 触发，使用 GitHub Secrets 中的 `QIQIXUE_COOKIE`。GitHub 不保存 `NOTION_TOKEN`。部署包含 `QIQIXUE_IMPORTS` SQLite Durable Object 迁移，用于并发去重和不确定写入的恢复。配置与运行方式见 [同步说明](docs/qiqixue-sync.md)。

## Development

```bash
npm install
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入本地 Notion Token
npm run dev
```

默认由 Wrangler 提供本地地址。修改后执行：

```bash
npm test
npm run check
# 可选：真实浏览器回归 /poetry 与 /poetry/（需要本机 Playwright）
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs npm run check:browser
# 可选：真实浏览器回归 /gallery 与 /gallery/（需要本机 Playwright）
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs npm run check:browser:gallery
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
curl https://child.malinkang.com/api/artworks
```

再打开线上页面确认固定任务、余额、媒体预览和浏览器控制台。

## Business Rules

- 时区固定为 `Asia/Shanghai`。
- 任务表是固定模板，不使用日期或完成状态。
- 同一任务每天可以完成任意多次，每次完成创建一条独立记录。
- 首页任务采用紧凑横向卡片，按可用宽度自动排列为一至三列；同时展示图标、任务名、每次星星数、今日次数及至少 44px 高的完成按钮。
- 首页任务卡片下方的「星星足迹」按北京时间展示年度获得星星热力图，仅统计正数获得记录，颜色表示当日获得星星数；同日多条记录全部计入，兑换不影响热力图。
- 热力图支持切换年份和内部横向滚动；悬停、键盘聚焦或手机点按时，提示先展示所选格子的北京时间日期和星期（如「9月21日 星期一」），再逐行展示当天记录的 `说明`，空说明不回退到标题。
- 新设备必须通过家长 PIN 授权，签名 Cookie 有效期为 30 天。
- 所有写入要求已授权；上课记录新增和修改不重复询问 PIN，兑换礼物仍会再次校验 PIN。
- 同一来源的写入操作至少间隔 2 秒；PIN 连续错误 5 次后暂时锁定 15 分钟。
- 上课记录页、头像及课堂媒体只对已授权设备开放。
- 上课记录的年度统计只计算 `已完成` 和 `试听`。
- 选择课堂媒体后立即并行预上传多个文件，每个文件内部按 10 MiB 顺序分片，并显示独立进度和失败重试；保存时才创建 Notion Page，并使用签名凭证写入已上传的 file ID。
- 课程表单支持时间联动：修改结束时间会反算时长，修改时长会计算结束时间；英语、体能和跳舞在 Notion 未配置默认值时分别使用 45、90 和 50 分钟。
- 体能课默认开始时间为 `09:00`，跳舞课默认开始时间为 `17:30`；切换课程时保留当前日期并自动填写时间。
- 应用不设置课堂媒体单文件大小上限，但仍受 Notion 工作区文件额度和平台请求限制约束。
- 媒体 URL 不返回浏览器，Worker 校验记录归属后代理文件和视频 Range 请求。
- 归档任务不能继续获得星星。
- 每条新记录必须关联唯一余额统计行。
- 余额只读取余额统计表的 `当前余额` Rollup。
- 兑换前读取最新 Rollup，余额不足时拒绝写入。
- 兑换媒体最多 5 个，单个文件最大 20 MB，仅支持图片和视频。
- 媒体上传至 Notion，不存储在浏览器或 Cloudflare。
- 诗文馆是公开只读页面，不要求设备授权，也不提供背诵或奖励写入。
- `/api/poetry` 按 `序号` 升序返回全部未归档诗文；缺失字段显示为「未标注」，不会中断整页。
- 作者关系按唯一作者页解析；请求按约 3 次/秒限速，遇到限流或临时错误会重试，解析失败的作者显示为「作者未标注」。
- 诗文响应缓存 60 秒并合并并发请求，失败结果不缓存；只有成功响应返回 `Cache-Control: public, max-age=60`。
- 页面只渲染 HTTP(S) 链接和音频，所有 Notion 文本在渲染前转义。
- 作品墙是公开只读页面，不要求设备授权，也不提供写入或奖励。
- `/api/artworks` 按 `序号` 升序返回未归档作品；缺失或异常字段不会中断整页，无效日期不显示。
- 作品媒体优先取页面正文的第一个 image/audio 区块，回退到 `图片`、`音频` 属性；单个作品读取失败不影响整墙。
- 作品媒体只通过 `/api/artwork-media/:pageId/(image|audio)` 代理：首次读取校验页面归属和状态后缓存媒体地址 30 分钟，缓存命中直接转发并保留 Range；Notion 或签名 URL 不返回浏览器。
- 作品响应缓存 60 秒并合并并发请求；媒体地址缓存 30 分钟后刷新，失败结果不缓存。
- 墙面用纯 CSS 画框平铺全部作品，点击放大后可用左右键、按钮或滑动循环切换，显示北京日期和讲述音频（不自动播放）。

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
