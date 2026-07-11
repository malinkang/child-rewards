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
- `NOTION_TOKEN`: Cloudflare Secret only. Never write it to files, output, frontend code, commits, or logs.

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
- `日期`: date
- `状态`: status
- `排序`: number
- Page icon: emoji or Notion-hosted image

### 星星记录

- `记录`: title
- `类型`: select (`获得` or `支出`)
- `星星`: signed number
- `任务`: relation to 每日任务
- `说明`: rich_text
- `时间`: date
- `余额`: number snapshot
- `媒体`: files

### 甜心礼品屋

- `礼品`: title
- `星星`: number
- `分类`: select
- `媒体`: files
- `启用`: checkbox
- `说明`: rich_text
- `排序`: number

Database IDs and the Done Status option ID are configured through `wrangler.toml`. The API version is `2022-06-28` for database/page operations and `2025-09-03` for Notion file-upload operations.

## Business Invariants

- Beijing time (`Asia/Shanghai`) defines the current task date and duplicate-earn day boundary.
- `/api/rewards` returns only tasks whose `日期` equals the current Beijing date.
- A task is checked when its Notion `状态` matches `NOTION_TASK_DONE_STATUS_ID` or the status name is `Done`.
- Completing a task creates one positive star record and then sets the task Status to Done.
- If the Status update fails, archive the newly created star record as rollback.
- Reject archived tasks, tasks from another database, non-current tasks, and duplicate daily earns.
- Balance is the sum of all active signed `星星` records. Do not calculate authoritative balance in the browser.
- Spending must validate the latest balance before uploading files or creating a negative record.
- Spending media is optional, limited to 5 files, 20 MB per file, and image/video MIME types.
- Media belongs in Notion file properties. Do not add browser `localStorage`, IndexedDB, R2, or repository assets for user uploads without explicit approval.
- Keep write endpoints same-origin protected. This is a lightweight safeguard, not full user authentication.

## API Surface

- `GET /api/rewards`: current Beijing-date tasks plus the complete active ledger and balance.
- `GET /api/gifts`: enabled gifts ordered by `排序` and creation time.
- `POST /api/earn`: body `{ taskId }`; validates and completes a task.
- `POST /api/spend`: JSON without media or multipart form data with `item`, `stars`, and repeated `media` files.
- Other `/api/*` routes return 404. Static requests fall through to `env.ASSETS`.

When adding an endpoint, update `README.md`, this file, and proportional tests in the same change.

## Data Safety

- Never delete, archive, reset, or rewrite real Notion records for testing.
- Inspect current Notion data before a write test; the user may edit Notion while work is in progress.
- Create test records with an unmistakable temporary title, capture every returned page ID, and clean up only those exact IDs.
- Re-query afterward to confirm test records are gone and the user's balance is unchanged.
- Never assume old task IDs remain active; users may duplicate, archive, or replace task rows.
- Do not expose signed Notion media URLs in logs or documentation.

## Frontend Rules

- Keep task cards driven entirely by `/api/rewards`; do not hardcode tasks in HTML or JavaScript.
- Use the Notion page icon for each task, supporting both emoji and image icons.
- Keep task completion derived from Notion Status, not ledger inference or local state after refresh.
- Preserve the two overview cards: 今日获得 and 本周获得.
- History entries with media show a thumbnail and open the shared media viewer.
- Gift media and reward-history media use the same viewer behavior.
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

- `/api/rewards` returns only today's Beijing-date tasks.
- Notion emoji and image icons render.
- Completing a temporary task persists Done after reload and prevents duplicate earning.
- Spending rejects insufficient balance.
- A real small image upload appears in the star record and history viewer.
- Temporary Notion pages are archived by exact ID and the original balance is restored.

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
