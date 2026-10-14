# AGENTS.md

## Project Scope

This repository is a personal child-rewards application deployed at `https://child.malinkang.com`.

- Keep the frontend framework-free unless the user explicitly requests a migration.
- Preserve the established Sanrio-inspired pastel visual language and responsive behavior.
- Treat Notion as the source of truth for tasks, task completion, star history, gifts, and media.
- Do not create child-related notes in another repository for work on this application.

## Architecture

- `public/index.html`: page structure and dialogs.
- `public/styles.css`: all responsive styling, illustrations, and motion.
- `public/app.js`: browser state, rendering, interactions, and calls to `/api/*`.
- `public/rewards-heatmap.js`: Beijing-date grouping and annual calendar layout for earned-star history.
- `public/poetry.html`, `public/poetry.css`, `public/poetry.js`: public read-only poetry library page, styling, and rendering.
- `public/poetry-library.js`: framework-free, side-effect-free poetry filtering, search, option ordering, escaping, and URL safety helpers (unit tested).
- `public/gallery.html`, `public/gallery.css`, `public/gallery.js`: public read-only artwork wall page, frame/wall styling, and the enlarged viewer.
- `public/gallery-model.js`: framework-free, side-effect-free artwork normalization, safe media-path validation, Asia/Shanghai date formatting, and wrap-around stepping helpers (unit tested).
- `src/index.js`: Cloudflare Worker router, validation, Notion reads/writes, media uploads, and static asset fallback.
- `src/qiqixue-sync.js`: machine-only learning import and per-source Durable Object deduplication.
- `scripts/sync-qiqixue.mjs`, `scripts/qiqixue.mjs`: GitHub Actions source fetch, validation, and sequential import.
- `wrangler.toml`: Worker deployment, custom domain, and non-secret Notion identifiers.
- `NOTION_TOKEN`, `AUTH_PIN`, and `AUTH_SECRET`: Cloudflare Secrets only. Never write them to files, output, frontend code, commits, or logs. `NOTION_ARTWORKS_TOKEN` is an optional Cloudflare Secret that overrides `NOTION_TOKEN` for the artwork wall only.

Data flow:

```text
Browser -> same-origin Worker API -> Notion API
```

The browser must never call Notion directly.

## Notion Contracts

Property names are exact API contracts. If a property is renamed in Notion, update the Worker mapping and this documentation together.

### 每日任务

- `任务`: title
- `星星`: number
- `说明`: rich_text
- `排序`: number
- Page icon: emoji or Notion-hosted image

### 星星记录

- `记录`: title
- `类型`: select (`获得` or `支出`)
- `星星`: signed number
- `任务`: relation to 每日任务
- `说明`: rich_text
- `时间`: date
- `媒体`: files
- `余额统计`: relation to the singleton 余额统计 row
- `来源 ID`: rich_text, optional permanent Qiqixue deduplication key `qiqixue:<accountId>:<recordId>`
- `备注`: rich_text, Qiqixue source start/end timestamps and session duration; keep `说明` concise (`阅读牛津树：书名`)

### 余额统计

- `统计`: title
- `星星记录`: relation to 星星记录
- `当前余额`: rollup sum of 星星记录.`星星`
- The database contains exactly one active row titled `多乐的星星余额`.

### 甜心礼品屋

- `礼品`: title
- `星星`: number
- `分类`: select
- `媒体`: files
- `启用`: checkbox
- `说明`: rich_text
- `排序`: number

### 孩子资料

- `姓名`: title
- `头像`: files
- `生日`: date
- `启用`: checkbox
- The database contains one active profile row configured by `NOTION_CHILD_PROFILE_PAGE_ID`.

### 课外课程

- `课程`: title
- Page icon: emoji or Notion-hosted image
- `颜色`: select
- `老师`: rich_text
- `地点`: rich_text
- `默认时长`: number
- `启用`: checkbox
- `排序`: number

### 上课记录

- `记录`: title
- `课程`: relation to 课外课程
- `上课时间`: date
- `状态`: status (`计划中`, `已完成`, `请假`, `取消`, `试听`)
- `时长`: number
- `上课内容`: rich_text
- `课堂表现`: select
- `老师点评`: rich_text
- `地点`: rich_text
- `媒体`: files

### 诗文馆

- `标题`: title
- `原文`: rich_text (render with original line breaks)
- `学段`: select (小学 / 初中 / 高中; blank rows render as `未标注`)
- `年级`: select (textbook labels such as `一年级上册`, `高中选择性必修中册`)
- `板块`: select
- `背诵状态`: select or status (`复习中` stays distinct; `已掌握` counts as mastered)
- `计划周次`: rich_text (e.g. `新学第 3 周`, `复习`, `中学长线`)
- `朝代`: select
- `类型`: multi_select (all options are rendered)
- `链接`: url (HTTP(S) only)
- `音频`: files (HTTP(S) only, never autoplayed)
- `作者`: relation, resolved through the related page title only
- `序号`: number (ascending; missing values sort last)

The poetry database ID is `NOTION_POETRY_DATABASE_ID` in `wrangler.toml`. The library is read-only: it never writes to Notion and never awards stars.

### 多乐作品墙

- `作品`: title
- `序号`: number (ascending; missing or invalid sorts last)
- `描述`: rich_text (child's narration; shown only in the enlarged viewer, never on the wall)
- `上传时间`: date (UTC instants; render in Asia/Shanghai)
- `图片`: files (HTTP(S) only; fallback when the page body has no image block)
- `音频`: files (HTTP(S) only; fallback when the page body has no audio block, never autoplayed)

Media truth is the page body: the first `image` block and first `audio` block win, because artwork rows may be re-uploaded (rotation fixes) after the files properties were written. The database ID is `NOTION_ARTWORKS_DATABASE_ID` and its data source is `NOTION_ARTWORKS_DATA_SOURCE_ID` in `wrangler.toml`. The wall is read-only: it never writes to Notion and never awards stars.

Database and singleton balance-page IDs are configured through `wrangler.toml`. The API version is `2022-06-28` for database/page operations and `2025-09-03` for Notion file-upload operations.

## Business Invariants

- Tasks are permanent templates and do not have a date or completion Status.
- Completing a task always creates one positive star record; the same task can be completed repeatedly on the same day.
- Reject archived tasks and tasks from another database.
- Every new ledger record must relate to `NOTION_BALANCE_PAGE_ID` through `余额统计`.
- The authoritative balance is the singleton balance page's `当前余额` Rollup. Never sum ledger entries for balance in the Worker or browser.
- Spending must validate the latest Rollup balance before uploading files or creating a negative record.
- Spending media is optional, limited to 5 files, 20 MB per file, and image/video MIME types.
- Media belongs in Notion file properties. Do not add browser `localStorage`, IndexedDB, R2, or repository assets for user uploads without explicit approval.
- Keep all browser write endpoints same-origin protected and require a valid signed device cookie.
- The sole machine exception is `POST /api/sync/qiqixue`, authenticated by a dedicated `QIQIXUE_SYNC_TOKEN`. Reject requests with Origin headers. This token cannot authorize browser routes.
- Qiqixue imports add positive records to the existing ledger, using the current active task configured by `NOTION_QIQIXUE_TASK_ID` and its current star value. Always validate task ownership and relate the balance singleton. Same-day source sessions stay separate; do not infer mastery. If an unlinked manual reward for this task exists on that Beijing day, stop for reconciliation instead of double-awarding.
- Keep source Cookie in GitHub Secrets and Notion credentials in Cloudflare Secrets. Never log source records, IDs, book names, Cookie values, or upstream error bodies in Actions.
- Each source ID uses a Durable Object for serialization and durable create-intent/page-ID metadata only. Notion remains the source of truth. Uncertain creates must be reconciled by source ID, never blindly retried. Preserve known archived imported pages and user edits.
- Device authorization lasts 30 days. Gift redemption additionally requires the current parent PIN on every attempt.
- Keep PIN comparison timing-safe, throttle failed PIN attempts, and enforce a short server-side write cooldown.
- Class profile, records, avatar, and media are private and require a valid device cookie for every read.
- Never return Notion class media URLs to the browser. Proxy media only after validating page/database ownership and preserve video Range headers.
- Class heatmap and summary statistics count only `已完成` and `试听` records in Beijing time.
- The poetry library at `/poetry` and `/poetry/` is public and read-only: no device cookie is required and no recitation or reward writes exist.
- `/api/poetry` sorts by ascending numeric `序号` (blank last), tolerates missing or malformed properties, and never hardcodes collection or mastered totals.
- Poetry responses use a bounded 60-second cache with in-flight coalescing scoped by source configuration; failed loads are never cached and only successful reads return `Cache-Control: public, max-age=60, s-maxage=60`.
- Author relations resolve once per refresh through bounded concurrency with ~3 req/s pacing and retry on 429/5xx; an unresolved author renders as `作者未标注`.
- Only HTTP(S) source links and audio URLs reach the browser; all Notion text is escaped before rendering.
- The artwork wall at `/gallery` and `/gallery/` is public and read-only: no device cookie, no writes, and no stars.
- `/api/artworks` sorts by ascending numeric `序号` (missing/invalid last, tie-break title then id), tolerates malformed rows, and returns only title, description, order, date, and same-origin media paths.
- Artwork media resolution prefers the first page-body `image`/`audio` file block and falls back to the `图片`/`音频` files property. One failing page must never fail the whole wall, and a failed block lookup is never cached.
- Artwork media streams only through `/api/artwork-media/:pageId/(image|audio)`. Validate that the page belongs to the artworks database and is active before its media is cached; a cache hit then streams within the bounded 30-minute TTL. Never return Notion or signed URLs to the browser or logs; preserve `Range` for audio seeking.
- Artwork payloads use a bounded 60-second cache with in-flight coalescing; media source URLs are cached 30 minutes (below signed-URL expiry) and dropped after a failed fetch. Successful media responses return `Cache-Control: public, max-age=300, s-maxage=3600`.

## API Surface

- `GET /api/rewards`: permanent task templates plus the complete active ledger and Rollup balance.
- `GET /api/gifts`: enabled gifts ordered by `排序` and creation time.
- `GET /api/poetry`: public read-only poetry library: poems ordered by `序号` plus observed totals and filter values.
- `GET /api/artworks`: public read-only artwork wall: artworks ordered by `序号` with description, Beijing-time date, and same-origin media paths.
- `GET /api/artwork-media/:pageId/(image|audio)`: public proxy for artwork media after validating page/database ownership; never exposes the source URL.
- `GET /api/auth`: returns whether the current device has a valid signed authorization cookie.
- `POST /api/auth/login`: validates the parent PIN and issues the 30-day HttpOnly cookie.
- `POST /api/auth/logout`: expires the authorization cookie.
- `GET /api/classes?year=YYYY`: returns the protected profile, courses, yearly records, and summary.
- `POST /api/classes`: requires an authorized device, validates signed completed upload credentials, and creates the record with all media file IDs in one Notion request without another PIN prompt.
- `PATCH /api/classes/:recordId`: updates validated class record fields from an authorized device while preserving its existing media.
- `POST /api/class-uploads/start`: creates a signed Notion multipart upload session immediately after file selection, before any class record exists.
- `POST /api/class-uploads/:uploadId/parts/:partNumber`: accepts one authenticated 10 MiB browser chunk and forwards it to Notion.
- `POST /api/class-uploads/:uploadId/complete`: completes the Notion upload and returns a signed 24-hour attachment credential for final page creation.
- `GET /api/class-avatar`: proxies the configured profile image.
- `GET /api/class-course-icon/:courseId`: proxies a validated Notion-hosted course icon.
- `GET /api/class-media/:recordId/:index`: proxies validated record media without exposing its source URL.
- `POST /api/earn`: body `{ taskId }`; validates the task and creates one earning record.
- `POST /api/spend`: JSON without media or multipart form data with `item`, `stars`, `pin`, and repeated `media` files.
- `POST /api/sync/qiqixue`: machine Bearer token only; `{ record: { sourceId, book, start, end, seconds, wifiPen }, dryRun: boolean }`; returns `created`, `exists`, or `would_create`. No private record data in responses; dry-run does not modify Notion or Durable Object storage.
- Other `/api/*` routes return 404. Static requests fall through to `env.ASSETS`.

When adding an endpoint, update `README.md`, this file, and proportional tests in the same change.

## Data Safety

- Never delete, archive, reset, or rewrite real Notion records for testing.
- Class media has no app-defined per-file size limit. Keep the five-file and image/video MIME constraints, parallel immediate pre-upload across files, sequential 10 MiB chunks within each file, signed upload/attachment credentials, per-file progress and retries, and the documented Notion/platform limit caveat.
- Class start/end/duration fields are linked in Beijing time. Course `默认时长` wins; fallback defaults are English 45, fitness 90, and dance 50 minutes.
- Course selection preserves the chosen date while applying fallback start times: fitness at 09:00 and dance at 17:30.
- Inspect current Notion data before a write test; the user may edit Notion while work is in progress.
- Create test records with an unmistakable temporary title, capture every returned page ID, and clean up only those exact IDs.
- Re-query afterward to confirm test records are gone and the user's balance is unchanged.
- Never assume old task IDs remain active; users may duplicate, archive, or replace task rows.
- Do not expose signed Notion media URLs in logs or documentation.

## Frontend Rules

- Keep task cards driven entirely by `/api/rewards`; do not hardcode tasks in HTML or JavaScript.
- Use the Notion page icon for each task, supporting both emoji and image icons.
- Task cards show today's completion count derived from ledger entries and always retain an enabled “完成一次” action.
- Preserve the two overview cards: 今日获得 and 本周获得.
- Keep the annual rewards heatmap directly below the tasks panel. Group only positive `earn` ledger records by Beijing date, with color based on daily earned stars; include every same-day record and exclude spending.
- Heatmap tooltips start with the cell's Beijing month, day, and weekday (for example, `9月21日 星期一`), followed by nonempty record `说明` values, one per line, without title/star-count fallbacks. Support hover, keyboard focus, and touch, and contain horizontal scrolling inside the heatmap.
- History entries with media show a thumbnail and open the shared media viewer.
- Gift media and reward-history media use the same viewer behavior.
- Locked devices may read data but must show locked task and redemption actions. Never treat frontend state as authorization.
- Shared navigation is rendered by `public/shared-nav.js`; add future sections to its centralized item list.
- The classes page must clear private in-memory data after device lock and keep horizontal overflow inside the heatmap scroller.
- History entries display their `说明` value as a distinct note in the home growth ledger.
- Fixed voice clips live in `public/audio/`; do not add a runtime TTS dependency without explicit approval.
- Choose welcome audio only after `/api/rewards` resolves. Use today's positive ledger entries to select not-started or in-progress audio.
- Play welcome audio at most once per Beijing date. If autoplay is blocked, defer it until the first user gesture.
- Each task completion may play its task-specific clip; there is no final-task state for repeatable tasks.
- Preserve the sound toggle, 55% playback volume, and the user's `localStorage` preference.
- Keep `docs/audio.md` synchronized when adding, replacing, or remapping voice clips.
- The poetry page must load every asset from root-absolute URLs (`/poetry.css`, `/poetry.js`, `/shared-nav.css`, `/fonts/...`) so that both `/poetry` and `/poetry/` work.
- Poetry filters combine school stage, grade, and recitation status with free-text search over title, author, dynasty, and body; grade choices follow textbook order and reset when incompatible with the selected stage.
- Keep poetry detail cards as native `<details>`/`<summary>` disclosures, keep original line breaks in `原文`, and use only escaped text and HTTP(S) links or audio.
- The artwork wall page must load every asset from root-absolute URLs (`/gallery.css`, `/gallery.js`, `/shared-nav.css`, `/fonts/...`) so that both `/gallery` and `/gallery/` work.
- Wall frames stay pure CSS (dark frame line, white matte, inner hairline, offset shadow) and render the artwork alone, with no caption card, badge or text. The artwork name lives in the image `alt` and the frame `aria-label` (`作品`, else `未命名作品`); the `描述` narration, the Beijing date and the narration audio appear only in the enlarged viewer.
- Clicking a frame opens the enlarged viewer. Keep the framed image, circular prev/next buttons, the `第 N / M 幅` counter, the child's narration text, the date, and an optional play button for the narration audio. Navigation wraps; `ArrowLeft`/`ArrowRight`, ~48px pointer swipes, backdrop clicks, and `Escape` all work, and focus returns to the frame that opened the viewer. The prev/next buttons must keep visible clearance from the frame and stay inside the viewport at every breakpoint.
- Never render non-`/api/artwork-media/...` media paths, never autoplay narration audio, stop and reset audio when switching or closing, and escape all Notion text before rendering.
- Respect `prefers-reduced-motion` and keep desktop/mobile layouts free of horizontal overflow.

## Verification

Before committing:

```bash
node --check src/index.js
node --check public/app.js
node --check public/poetry.js
node --check public/poetry-library.js
node --check public/gallery.js
node --check public/gallery-model.js
git diff --check
npm test
npm run check
```

Optional real-browser regression for the poetry page (requires a local Playwright install, no real Notion access):

```bash
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs npm run check:browser
```

Optional real-browser regression for the artwork wall (same Playwright setup, no real Notion access):

```bash
PLAYWRIGHT_PATH=/path/to/playwright/index.mjs npm run check:browser:gallery
```

For local integration testing, run Wrangler with `.dev.vars`, then verify:

- `/api/rewards` returns all active task templates and the singleton Rollup balance.
- Notion emoji and image icons render.
- Completing the same temporary task twice creates two independent earning records and increments today's count twice.
- Spending rejects insufficient balance.
- A real small image upload appears in the star record and history viewer.
- Audio assets return HTTP 200, the sound toggle persists, and state-specific clips are selected correctly.
- `/api/poetry` returns every non-archived poem in ascending `序号` order with observed totals, and `/poetry` plus `/poetry/` load every asset (no 404s on `/poetry/poetry.js`).
- Poetry stage/grade/status filters, search by title/author/dynasty/body, and the reset control behave together; grade options follow textbook order and reset when the stage changes.
- `/api/artworks` returns every non-archived artwork in ascending `序号` order with only same-origin media paths, and `/gallery` plus `/gallery/` load every asset (no 404s on `/gallery/gallery.js`).
- Clicking a wall frame opens the viewer with the date; arrow keys and buttons wrap around; image and audio bytes stream through `/api/artwork-media/...` with correct content types and working `Range`.
- Temporary Notion pages are archived by exact ID, their balance relations disappear from the Rollup, and the original balance is restored.

After deployment:

- Verify `https://child.malinkang.com/api/rewards` and `/api/gifts`.
- Verify `https://child.malinkang.com/api/poetry`, `/poetry` and `/poetry/`; the poetry counts come from the live response, not from this document.
- Verify `https://child.malinkang.com/api/artworks`, `/gallery` and `/gallery/`; the artwork count and media come from the live response, and no Notion URL appears in the payload.
- Open a cache-busted page URL if browser state appears stale.
- Check desktop/mobile overflow and browser console errors.
- Confirm the Notion ledger contains no temporary active records.

## Git And Deployment

- Production deployment: `npm run deploy`.
- Build validation: `npm run check`.
- Repository: `https://github.com/malinkang/child-rewards`.
- Default branch: `main`.
- Do not commit `.dev.vars`, `.env`, `.wrangler/`, `node_modules/`, tokens, or signed media URLs.
- Stage only files related to the requested change, commit tersely, and push `main` when the user asks to publish.
