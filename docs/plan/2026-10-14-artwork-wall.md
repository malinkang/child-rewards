# 作品墙（Artwork Wall）

- Created: 2026-10-14
- Status: in_progress

## Scope and decisions

Add a public read-only artwork wall at `/gallery` and `/gallery/` that brings the child's 17 artworks (exported from twinkle.art into Notion) onto the site. The visual language mirrors the twinkle.art gallery: each artwork hangs in a physical-looking frame (thin dark frame line, wide white matte, hairline inner matte line, offset soft drop shadow) with a white label card. The wall shows every artwork at once; clicking a frame opens an enlarged viewer with previous/next navigation, the Beijing-time date, the description and the child's narration audio. No writes, no stars.

Decisions:

- Public page (no device cookie), like `/poetry`; the source twinkle.art gallery is already public. The shared navigation gains a 作品墙 item.
- Notion stays the single source of truth. The browser never calls Notion; media is streamed through same-origin Worker routes and no Notion or signed URL ever reaches the browser or logs.
- The frame is recreated with pure CSS, no third-party assets are copied into the repository. Reverse-engineered twinkle.art values for reference: near-black frame + white matte (`border-image-slice:660`, 2684px texture), frame weight 140px at >=1024px and 80px below, artwork inset 95px / 55px, matte offset 52px / 31px, `mix-blend-mode:multiply; opacity:.7` on the frame layer, label card `180px` wide with `1px` hairline and `2px 2px 1px rgba(0,0,0,.06)` shadow.
- Dates come from `上传时间` and render in Asia/Shanghai (e.g. `2026年10月13日`). The wall mirrors the reference label order: primary text = `描述` when present, otherwise the artwork title.

## Source data

Notion database 「多乐作品墙」, 17 live rows, `序号` 1–17. Configure only the non-secret id:

```
NOTION_ARTWORKS_DATABASE_ID = "c50145f3-aece-4c7a-93a6-1b3c1e2db0d4"
```

(data source `62621208-c307-4879-bda4-1984012eef4c`; legacy `/databases/{id}/query` works for the existing poetry database of the same shape — verify live and report if the runtime rejects it.)

Exact property contract:

- `作品`: title (`多乐作品 01` … `多乐作品 17`)
- `序号`: number (ascending; missing/invalid sorts last)
- `描述`: rich_text (rows 01–03 only; source truth — 04–17 intentionally have no description)
- `上传时间`: date (UTC instants; 01–03 = 2026-10-13, 04–17 = 2026-10-14)
- `图片`: files (twinkle CDN external URL; fallback only)
- `音频`: files (rows 01–03; fallback only)

Media truth lives in each page body as Notion-hosted file blocks (`image` block, and `audio` block for rows 01–03). Rows 04 and 07 were re-downloaded corrected after source rotation, so page-body blocks must be preferred; the property files are only an HTTP(S) fallback when no block of that kind resolves. Never expose the Notion file URL itself.

Token: reuse the poetry pattern — `NOTION_ARTWORKS_TOKEN || NOTION_TOKEN`. If the Cloudflare integration cannot read the new database, live verification is blocked until the user shares it with the integration (human-assisted step; request only 10:00–18:00 Asia/Shanghai).

## API

`GET /api/artworks` — public, GET only. Response headers `Cache-Control: public, max-age=60, s-maxage=60` on success only. Bounded 60-second module cache plus in-flight coalescing keyed by database id + `NOTION_VERSION` (separate maps from the poetry cache, never shared keys). Failures are never cached and drop out of the in-flight map.

Payload:

```json
{
  "artworks": [
    {
      "id": "3f986019-c92c-81b7-818a-e6d6d4b0c127",
      "order": 1,
      "title": "多乐作品 01",
      "description": "黑暗黑开始就是海草……",
      "date": "2026-10-13T15:30:00.000Z",
      "image": "/api/artwork-media/3f986019-c92c-81b7-818a-e6d6d4b0c127/image",
      "audio": "/api/artwork-media/3f986019-c92c-81b7-818a-e6d6d4b0c127/audio"
    }
  ],
  "stats": { "count": 17, "withDescription": 3, "withAudio": 3 },
  "refreshedAt": "2026-10-14T09:00:00.000Z"
}
```

- Query all active pages (`!archived && !in_trash`), request `sorts: [{ property: '序号', direction: 'ascending' }]`, then sort defensively: numeric `序号` ascending, missing/invalid last, tie-break `title` (`zh-Hans-CN`) then id.
- Defensive mapping: missing/malformed description → `""`; invalid date → `null`; title may be `""` but the UI falls back.
- Media resolution at load time: for each active page fetch `GET /blocks/{pageId}/children` with bounded concurrency 4 and ~340ms pacing (reuse the poetry author-resolution pattern; never an unpaced N+1), take the first `image` block and the first `audio` block. Store `{ kind: { url, name } }` in a module-level `artworkMediaCache` keyed `databaseId:pageId` with a 30-minute TTL (well below signed-URL expiry) and a bounded entry count. A page whose block fetch fails must not fail the whole payload: fall back to the HTTP(S) property file, otherwise omit that media.
- `audio` is `null` unless a usable audio source resolves.

`GET /api/artwork-media/:pageId/:kind` — public GET, `kind` ∈ `image | audio`, id validated with the existing `[0-9a-f-]{32,36}` pattern.

- Cache hit: stream immediately. Cache miss: `GET /pages/{pageId}`, validate the parent is the artworks database and the page is not archived/trashed, then fetch the page blocks, cache (30-minute TTL) and stream.
- Stream bytes through the existing `proxyNotionFile` helper semantics: preserve `Range` (audio seeking), derive `Content-Type` from the file name, never echo the source URL. Override cache headers to `public, max-age=300, s-maxage=3600` (content is stable; the wall is public).
- Missing media → 404 `{ error, code: 'MEDIA_NOT_FOUND' }`; invalid parent → 404.

Routing: `/gallery` and `/gallery/` serve `/gallery.html` exactly like the poetry routes. Unknown `/api/*` keeps returning 404.

## Page and UI

New files `public/gallery.html`, `public/gallery.css`, `public/gallery.js`, `public/gallery-model.js`; add `{ id: 'gallery', label: '作品墙', icon: '🎨', href: '/gallery' }` to `public/shared-nav.js` after 诗文馆. All assets load from root-absolute URLs with a `?v=20261014` cache-buster (`/gallery.css`, `/gallery.js`, `/shared-nav.css`, `/fonts/...`) so both `/gallery` and `/gallery/` work.

Page structure and copy:

- `<title>多乐的作品墙</title>`, eyebrow `Artwork Wall`, `h1 多乐的作品墙`, note `点开一幅画就能放大看，还能左右翻看前一幅和后一幅。`, refresh button like poetry.
- Stats chip from the payload: `17 幅作品 · 3 幅有讲述`.
- Wall: masonry via CSS `columns` (`columns: 4 240px` desktop steps down to 1 column on phones), each item a `<figure>`: `<button class="frame">` containing the image (frame chrome via CSS: `background:#fff; border:3px solid` ink tone; `padding:clamp(14px,4.5%,34px)`; `box-shadow:12px 14px 0 rgba(126,77,101,.12), 0 20px 34px rgba(126,77,101,.16)`; image `border:1px solid rgba(92,71,82,.16)`), plus a white label card: primary text = description (2-line clamp) else title, meta line = `作品名 · 2026年10月13日`, a small 🔊 badge when audio exists. Images use `loading="lazy" decoding="async"` and descriptive `alt` text. Staggered reveal via `--i` custom property; disabled under `prefers-reduced-motion`.
- Viewer: native `<dialog id="artworkViewer">` with `showModal()`. Centered enlarged framed artwork (max ~86vh), caption card (primary text, meta `第 5 幅 · 多乐作品 05 · 2026年10月14日`), close button, circular prev/next buttons, `aria-live` counter. Previous/next wrap around. Keys: `ArrowLeft`, `ArrowRight`, `Escape` (cancel). Touch: pointer swipe threshold ~48px. Backdrop click closes. Focus returns to the frame button that opened it.
- Audio: one lazily created `Audio` element bound to the current artwork's same-origin `audio` path; button toggles play/pause (`听多乐讲讲这幅画` / `暂停讲述`), no autoplay, stop and reset on switch/close. No audio button on artworks without audio.
- States: loading `正在把画挂上墙…`, empty `作品墙还空着，先在 Notion 里添加第一幅作品吧。`, error + `重新读取` retry button; shared nav mounted with auth toggle and PIN dialog like poetry (the page itself stays public).
- Escape all Notion text before inserting (reuse `escapeHtml` from `public/poetry-library.js`); only same-origin `/api/artwork-media/...` paths are accepted as media sources.

`public/gallery-model.js` stays side-effect-free and unit-tested: `mapArtworks(payload)` (defensive normalization, path validation), `formatArtworkDate(iso)` (Asia/Shanghai `2026年10月13日`, invalid → `''`), `artworkLabel(artwork)` (description else title else `未命名作品`), `stepIndex(current, delta, total)` (wrap-around, safe on 0/1 items).

## Tests

- `tests/artworks.test.js` (worker-level, mocked `fetch`, poetry test style): order by `序号` with null last; mapping of title/description/date; same-origin media paths only; `audio` null when absent; block-preferred and property-fallback resolution; block failure isolated to one artwork; 60s payload cache and cache-key isolation per database id; failures not cached; media proxy streams bytes, forwards `Range`, rejects a wrong parent database, never leaks the signed URL in body or headers; missing config → 500.
- `tests/gallery-model.test.js`: date formatting across the UTC→Asia/Shanghai date boundary (`2026-10-13T15:30Z` → `2026年10月13日`, `2026-10-13T17:00Z` → `2026年10月14日`), label fallback, wrap-around stepping, malformed payload dropping.
- `scripts/check-gallery-page.mjs` + npm script `check:browser:gallery`: same fixture-server pattern as the poetry check; assert 3 synthetic frames render (one with audio, mixed orientations), clicking opens the viewer, the date is shown, `ArrowRight`/`ArrowLeft` navigate with wrap, `Escape` closes and restores focus, no console errors or failed requests, and no horizontal overflow at 1280px and 390px.

## Stages

- [ ] P0: commit this plan, create the isolated implementation worktree/chat, confirm a real Goal before any business edit.
- [ ] P1: Worker config, `/api/artworks`, `/api/artwork-media/:pageId/:kind`, route, caching/pacing and `tests/artworks.test.js`.
- [ ] P2: gallery page, wall/frame/viewer UI, shared-nav entry, `gallery-model.js` tests, browser check script, README and project AGENTS.md updates.
- [ ] P3: independent review of the actual diff, required syntax/test/browser checks, fixes until acceptance.
- [ ] P4: integrate and push `main`, deploy the reviewed commit, verify `/api/artworks` (17 rows, media bytes), `/gallery`, `/gallery/` and existing routes live, record the rollback version, clean the task workspace.
- [ ] P5: final completion-status commit with test and release evidence, pushed.

## Acceptance

Run `node --check src/index.js`, syntax checks for every new/changed public JS file, `git diff --check`, `npm test`, `npm run check`, and `PLAYWRIGHT_PATH=<playwright-core/index.mjs> npm run check:browser:gallery`. Confirm live after deploy: `/api/artworks` returns 17 ordered artworks with 3 descriptions and 3 audio entries and no Notion URLs; image and audio bytes stream with correct content types and working Range; `/gallery` and `/gallery/` load every asset without 404s; keyboard, swipe, wrap-around and date display behave; `/api/rewards`, `/api/gifts`, `/api/poetry`, `/poetry`, `/poetry/` and `/classes` are unchanged. Inspect current Notion data before verification; never write to real records. Record exact commits, deployment id, rollback version and cleanup evidence here before marking complete.

## Evidence

(filled during P0–P5)
