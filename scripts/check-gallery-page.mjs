// Real-browser regression for /gallery and /gallery/.
//
// Serves the checked-in public/ directory plus synthetic /api fixtures (no real
// Notion access) and drives Chrome with Playwright. Playwright is not a project
// dependency; point PLAYWRIGHT_PATH (or PLAYWRIGHT_MODULE) at an installation,
// or install it locally.
// Without Playwright the script prints SKIP and exits 0 unless --strict is passed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const strict = process.argv.includes('--strict');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.mp3': 'audio/mpeg',
};

// Real PNGs with different orientations so layout, lazy loading and the viewer
// exercise realistic aspect ratios without touching the network.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function makePng(width, height, [red, green, blue]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    for (let x = 0; x < width; x += 1) {
      const shade = (x + y) % 24 < 12 ? 0 : 28;
      raw[row + 1 + x * 3] = Math.min(255, red + shade);
      raw[row + 2 + x * 3] = Math.min(255, green + shade);
      raw[row + 3 + x * 3] = Math.min(255, blue + shade);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const ARTWORK_IDS = ['a'.repeat(32), 'b'.repeat(32), 'c'.repeat(32)];
const ARTWORKS = [
  {
    id: ARTWORK_IDS[0],
    order: 1,
    title: '多乐作品 01',
    description: '黑暗黑开始就是海草。',
    date: '2026-10-13T15:30:00.000Z',
    image: `/api/artwork-media/${ARTWORK_IDS[0]}/image`,
    audio: `/api/artwork-media/${ARTWORK_IDS[0]}/audio`,
  },
  {
    id: ARTWORK_IDS[1],
    order: 2,
    title: '多乐作品 02',
    description: '',
    date: '2026-10-14T08:18:00.000Z',
    image: `/api/artwork-media/${ARTWORK_IDS[1]}/image`,
    audio: null,
  },
  {
    id: ARTWORK_IDS[2],
    order: 3,
    title: '',
    description: '',
    date: null,
    image: `/api/artwork-media/${ARTWORK_IDS[2]}/image`,
    audio: null,
  },
];

// Portrait, landscape and square so the wall mixes orientations like real work.
const ARTWORK_PNG = new Map([
  [ARTWORK_IDS[0], makePng(360, 480, [245, 143, 177])],
  [ARTWORK_IDS[1], makePng(480, 360, [105, 189, 218])],
  [ARTWORK_IDS[2], makePng(420, 420, [255, 216, 110])],
]);

function startServer(mode) {
  let calls = 0;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      response.end(body);
    };
    if (url.pathname === '/favicon.ico') return send(204, '');
    if (url.pathname === '/api/auth') return send(200, JSON.stringify({ authenticated: false }));
    if (url.pathname === '/api/artworks') {
      calls += 1;
      if (mode === 'error' || (mode === 'retry' && calls === 1)) return send(500, JSON.stringify({ error: '作品墙读取失败' }));
      if (mode === 'empty') return send(200, JSON.stringify({ artworks: [], stats: { count: 0, withDescription: 0, withAudio: 0 } }));
      return send(200, JSON.stringify({
        artworks: ARTWORKS,
        stats: { count: 3, withDescription: 1, withAudio: 1 },
        refreshedAt: '2026-10-14T09:00:00.000Z',
      }));
    }
    if (url.pathname.startsWith('/api/artwork-media/')) {
      if (url.pathname.endsWith('/audio')) {
        response.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=300' });
        return response.end(Buffer.from([0xff, 0xfb, 0x90, 0x64]));
      }
      const png = ARTWORK_PNG.get(url.pathname.split('/')[3]);
      if (!png) return send(404, 'not found', 'text/plain');
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      return response.end(png);
    }
    if (url.pathname.startsWith('/api/')) return send(404, JSON.stringify({ error: 'Not found' }));
    let file = (url.pathname === '/gallery' || url.pathname === '/gallery/') ? '/gallery.html' : url.pathname;
    const full = path.join(publicDir, file);
    if (!full.startsWith(publicDir) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) return send(404, 'not found', 'text/plain');
    response.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(response);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise((done) => server.close(done)) })));
}

async function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, process.env.PLAYWRIGHT_MODULE, 'playwright'].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch { /* try the next candidate */ }
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function inspectPage(browser, port, pathname) {
  const page = await browser.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText || ''}`));
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failedRequests.push(`${response.status()} ${response.url()}`); });
  await page.goto(`http://127.0.0.1:${port}${pathname}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.wall-item', { timeout: 5000 });
  const summary = await page.evaluate(() => ({
    items: document.querySelectorAll('.wall-item').length,
    frames: document.querySelectorAll('.wall-frame').length,
    labels: Array.from(document.querySelectorAll('.wall-label-text')).map((node) => node.textContent),
    frameHeights: Array.from(document.querySelectorAll('.wall-frame')).map((node) => Math.round(node.getBoundingClientRect().height)),
    audioBadges: document.querySelectorAll('.wall-label-audio').length,
    navLinks: document.querySelectorAll('.nav-link').length,
    current: document.querySelector('.nav-link.is-current')?.textContent?.trim() || '',
    stats: document.getElementById('wallStats')?.textContent || '',
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert(summary.items === 3 && summary.frames === 3, `${pathname}: expected 3 framed artworks, saw ${summary.items}/${summary.frames}`);
  assert(summary.labels[0] === '黑暗黑开始就是海草。', `${pathname}: expected the description as the first label, saw ${summary.labels[0]}`);
  assert(summary.labels[1] === '多乐作品 02', `${pathname}: expected the title as the second label, saw ${summary.labels[1]}`);
  assert(summary.labels[2] === '未命名作品', `${pathname}: expected the unknown-artwork fallback, saw ${summary.labels[2]}`);
  assert(summary.audioBadges === 1, `${pathname}: expected one 🔊 badge, saw ${summary.audioBadges}`);
  assert(summary.frameHeights[0] > summary.frameHeights[1], `${pathname}: expected the portrait artwork to hang taller than the landscape one (${summary.frameHeights.join(',')})`);
  assert(summary.navLinks === 4, `${pathname}: expected 4 nav links, saw ${summary.navLinks}`);
  assert(summary.current.includes('作品墙'), `${pathname}: expected current nav item 作品墙, saw ${summary.current}`);
  assert(summary.stats.includes('3 幅作品') && summary.stats.includes('1 幅有讲述'), `${pathname}: unexpected stats chip ${summary.stats}`);
  assert(summary.overflow <= 1, `${pathname}: horizontal overflow of ${summary.overflow}px at desktop width`);

  await page.click('.wall-frame');
  await page.waitForFunction(() => document.getElementById('artworkViewer')?.open === true, null, { timeout: 5000 });
  const first = await page.evaluate(() => ({
    meta: document.getElementById('viewerMeta').textContent,
    title: document.getElementById('viewerTitle').textContent,
    date: document.getElementById('viewerDate').textContent,
    dateHidden: document.getElementById('viewerDate').hidden,
    audioVisible: !document.getElementById('viewerAudio').hidden,
    image: new URL(document.getElementById('viewerImage').src).pathname,
    bodyLocked: document.body.classList.contains('viewer-open'),
  }));
  assert(first.meta === '第 1 / 3 幅', `${pathname}: unexpected viewer counter ${first.meta}`);
  assert(first.title === '黑暗黑开始就是海草。', `${pathname}: unexpected viewer title ${first.title}`);
  assert(first.date === '2026年10月13日' && !first.dateHidden, `${pathname}: unexpected viewer date ${first.date}`);
  assert(first.audioVisible, `${pathname}: expected the narration button for the first artwork`);
  assert(first.image === `/api/artwork-media/${ARTWORK_IDS[0]}/image`, `${pathname}: unexpected viewer image ${first.image}`);
  assert(first.bodyLocked, `${pathname}: viewer did not lock body scroll`);

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('viewerMeta').textContent === '第 2 / 3 幅');
  const second = await page.evaluate(() => ({
    title: document.getElementById('viewerTitle').textContent,
    date: document.getElementById('viewerDate').textContent,
    dateHidden: document.getElementById('viewerDate').hidden,
    audioVisible: !document.getElementById('viewerAudio').hidden,
    image: new URL(document.getElementById('viewerImage').src).pathname,
  }));
  assert(second.title === '多乐作品 02', `${pathname}: unexpected second title ${second.title}`);
  assert(second.date === '2026年10月14日' && !second.dateHidden, `${pathname}: unexpected second date ${second.date}`);
  assert(!second.audioVisible, `${pathname}: audio button should be hidden without narration`);
  assert(second.image === `/api/artwork-media/${ARTWORK_IDS[1]}/image`, `${pathname}: unexpected second image ${second.image}`);

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('viewerMeta').textContent === '第 3 / 3 幅');
  const third = await page.evaluate(() => ({
    title: document.getElementById('viewerTitle').textContent,
    dateHidden: document.getElementById('viewerDate').hidden,
  }));
  assert(third.title === '未命名作品', `${pathname}: unexpected third title ${third.title}`);
  assert(third.dateHidden, `${pathname}: date should stay hidden when the artwork has none`);

  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('viewerMeta').textContent === '第 1 / 3 幅');
  assert(await page.evaluate(() => document.getElementById('viewerTitle').textContent) === '黑暗黑开始就是海草。', `${pathname}: ArrowRight did not wrap around`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => document.getElementById('viewerMeta').textContent === '第 3 / 3 幅');
  assert(await page.evaluate(() => document.getElementById('viewerTitle').textContent) === '未命名作品', `${pathname}: ArrowLeft did not wrap backwards`);

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('artworkViewer')?.open === false, null, { timeout: 5000 });
  const closed = await page.evaluate(() => ({
    active: document.activeElement?.className || '',
    activeIndex: document.activeElement?.dataset?.index || '',
    bodyLocked: document.body.classList.contains('viewer-open'),
  }));
  assert(!closed.bodyLocked, `${pathname}: body scroll lock stayed after closing the viewer`);
  assert(closed.active.includes('wall-frame') && closed.activeIndex === '0', `${pathname}: focus was not restored to the opening frame (${closed.active}/${closed.activeIndex})`);
  await page.screenshot({ path: path.join('/tmp', `gallery${pathname.replaceAll('/', '_')}-desktop.png`) });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
  }));
  assert(mobile.overflow <= 1 && mobile.bodyOverflow <= 1, `${pathname}: horizontal overflow at 390px (${mobile.overflow}/${mobile.bodyOverflow})`);
  await page.click('.wall-frame');
  await page.waitForFunction(() => document.getElementById('artworkViewer')?.open === true, null, { timeout: 5000 });
  const mobileViewer = await page.evaluate(() => {
    const image = document.getElementById('viewerImage').getBoundingClientRect();
    return {
      fits: image.width <= window.innerWidth && image.height <= window.innerHeight * 0.75,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  assert(mobileViewer.fits, `${pathname}: enlarged artwork overflows the mobile viewport`);
  assert(mobileViewer.overflow <= 1, `${pathname}: viewer introduced mobile overflow (${mobileViewer.overflow}px)`);
  await page.screenshot({ path: path.join('/tmp', `gallery${pathname.replaceAll('/', '_')}-390.png`) });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.getElementById('artworkViewer')?.open === false, null, { timeout: 5000 });
  assert(consoleErrors.length === 0, `${pathname}: console errors ${consoleErrors.join(' | ')}`);
  assert(failedRequests.length === 0, `${pathname}: failed requests ${failedRequests.join(' | ')}`);
  await page.close();
}

async function main() {
  const playwright = await loadPlaywright();
  if (!playwright) {
    console.log('SKIP: Playwright is not installed. Set PLAYWRIGHT_PATH or install playwright to run the browser regression.');
    if (strict) process.exitCode = 1;
    return;
  }
  const browser = await playwright.chromium.launch({ channel: 'chrome', headless: true });
  try {
    const normal = await startServer('normal');
    try {
      await inspectPage(browser, normal.port, '/gallery');
      await inspectPage(browser, normal.port, '/gallery/');
    } finally { await normal.close(); }

    const empty = await startServer('empty');
    try {
      const page = await browser.newPage();
      const failed = [];
      page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failed.push(`${response.status()} ${response.url()}`); });
      await page.goto(`http://127.0.0.1:${empty.port}/gallery/`, { waitUntil: 'networkidle' });
      const text = await page.locator('#artworkWall').innerText();
      assert(text.includes('作品墙还空着'), `empty state missing, saw: ${text}`);
      assert(failed.length === 0, `empty state failed requests ${failed.join(' | ')}`);
      await page.close();
    } finally { await empty.close(); }

    const retry = await startServer('retry');
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${retry.port}/gallery/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#retryButton', { timeout: 5000 });
      await page.click('#retryButton');
      await page.waitForSelector('.wall-item', { timeout: 5000 });
      assert(await page.locator('.wall-item').count() === 3, 'retry did not load the wall');
      await page.close();
    } finally { await retry.close(); }
    console.log('OK: /gallery and /gallery/ render the framed wall, navigate with wrap-around and keep dates visible.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
