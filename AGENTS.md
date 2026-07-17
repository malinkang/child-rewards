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
- `src/index.js`: Cloudflare Worker router, validation, Notion reads/writes, media uploads, and static asset fallback.
- `wrangler.toml`: Worker deployment, custom domain, and non-secret Notion identifiers.
- `NOTION_TOKEN`, `AUTH_PIN`, and `AUTH_SECRET`: Cloudflare Secrets only. Never write them to files, output, frontend code, commits, or logs.

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
- Keep all write endpoints same-origin protected and require a valid signed device cookie.
- Device authorization lasts 30 days. Gift redemption additionally requires the current parent PIN on every attempt.
- Keep PIN comparison timing-safe, throttle failed PIN attempts, and enforce a short server-side write cooldown.
- Class profile, records, avatar, and media are private and require a valid device cookie for every read.
- Never return Notion class media URLs to the browser. Proxy media only after validating page/database ownership and preserve video Range headers.
- Class heatmap and summary statistics count only `已完成` and `试听` records in Beijing time.

## API Surface

- `GET /api/rewards`: permanent task templates plus the complete active ledger and Rollup balance.
- `GET /api/gifts`: enabled gifts ordered by `排序` and creation time.
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
- Other `/api/*` routes return 404. Static requests fall through to `env.ASSETS`.

When adding an endpoint, update `README.md`, this file, and proportional tests in the same change.

## Data Safety

- Never delete, archive, reset, or rewrite real Notion records for testing.
- Class media has no app-defined per-file size limit. Keep the five-file and image/video MIME constraints, immediate pre-upload, 10 MiB chunks, signed upload/attachment credentials, per-file progress and retries, and the documented Notion/platform limit caveat.
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
- History entries with media show a thumbnail and open the shared media viewer.
- Gift media and reward-history media use the same viewer behavior.
- Locked devices may read data but must show locked task and redemption actions. Never treat frontend state as authorization.
- Shared navigation is rendered by `public/shared-nav.js`; add future sections to its centralized item list.
- The classes page must clear private in-memory data after device lock and keep horizontal overflow inside the heatmap scroller.
- Fixed voice clips live in `public/audio/`; do not add a runtime TTS dependency without explicit approval.
- Choose welcome audio only after `/api/rewards` resolves. Use today's positive ledger entries to select not-started or in-progress audio.
- Play welcome audio at most once per Beijing date. If autoplay is blocked, defer it until the first user gesture.
- Each task completion may play its task-specific clip; there is no final-task state for repeatable tasks.
- Preserve the sound toggle, 55% playback volume, and the user's `localStorage` preference.
- Keep `docs/audio.md` synchronized when adding, replacing, or remapping voice clips.
- Respect `prefers-reduced-motion` and keep desktop/mobile layouts free of horizontal overflow.

## Verification

Before committing:

```bash
node --check src/index.js
node --check public/app.js
git diff --check
npm run check
```

For local integration testing, run Wrangler with `.dev.vars`, then verify:

- `/api/rewards` returns all active task templates and the singleton Rollup balance.
- Notion emoji and image icons render.
- Completing the same temporary task twice creates two independent earning records and increments today's count twice.
- Spending rejects insufficient balance.
- A real small image upload appears in the star record and history viewer.
- Audio assets return HTTP 200, the sound toggle persists, and state-specific clips are selected correctly.
- Temporary Notion pages are archived by exact ID, their balance relations disappear from the Rollup, and the original balance is restored.

After deployment:

- Verify `https://child.malinkang.com/api/rewards` and `/api/gifts`.
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
