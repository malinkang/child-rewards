// Real-browser regression for /poetry and /poetry/.
//
// Serves the checked-in public/ directory plus synthetic /api fixtures (no real
// Notion access) and drives Chrome with Playwright. Playwright is not a project
// dependency; point PLAYWRIGHT_PATH (or PLAYWRIGHT_MODULE) at an installation,
// or install it locally.
// Without Playwright the script prints SKIP and exits 0 unless --strict is passed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const strict = process.argv.includes('--strict');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.ttf': 'font/ttf', '.png': 'image/png', '.mp3': 'audio/mpeg',
};

const POEMS = [
  { id: 'p1', title: '静夜思', body: '床前明月光，\n疑是地上霜。\n举头望明月，\n低头思故乡。', stage: '小学', grade: '一年级上册', section: '古诗', status: '已掌握', week: '新学第 1 周', dynasty: '唐', type: ['五言绝句'], link: 'https://example.test/jingyesi', audio: [{ name: '静夜思.mp3', url: 'https://cdn.example.test/jingyesi.mp3' }], authors: ['李白'], order: 1 },
  { id: 'p2', title: '望岳', body: '岱宗夫如何？\n齐鲁青未了。', stage: '初中', grade: '七年级上册', section: '古诗', status: '复习中', week: '复习', dynasty: '唐', type: ['五言古诗', '写景'], link: 'javascript:alert(1)', audio: [], authors: ['杜甫'], order: 2 },
  { id: 'p3', title: '赤壁赋', body: '壬戌之秋，七月既望。', stage: '高中', grade: '高中必修上册', section: '文言文', status: '已掌握', week: '中学长线', dynasty: '宋', type: ['赋'], link: 'https://example.test/chibi', audio: [{ name: 'x.mp3', url: 'javascript:alert(2)' }], authors: [], order: 3 },
  { id: 'p4', title: '咏鹅', body: '', stage: '小学', grade: '一年级上册', section: '古诗', status: '已掌握', week: '第 1 周', dynasty: '唐', type: ['五言古诗'], link: '', audio: [], authors: ['骆宾王'], order: 4 },
];

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
    if (url.pathname === '/api/poetry') {
      calls += 1;
      if (mode === 'error' || (mode === 'retry' && calls === 1)) return send(500, JSON.stringify({ error: '诗文馆读取失败' }));
      if (mode === 'empty') return send(200, JSON.stringify({ poems: [], stats: { total: 0, mastered: 0, byStatus: [], byStage: [] } }));
      return send(200, JSON.stringify({ poems: POEMS, stats: { total: 4, mastered: 3, byStatus: [{ name: '已掌握', count: 3 }, { name: '复习中', count: 1 }], byStage: [] } }));
    }
    const contentMatch = url.pathname.match(/^\/api\/poetry\/([^/]+)\/content$/);
    if (contentMatch) {
      if (contentMatch[1] === 'p4') {
        return send(200, JSON.stringify({
          id: 'p4',
          text: '鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。',
          translation: '白鹅伸长脖子对天唱歌。',
          appreciation: '骆宾王幼年即作此诗。',
        }));
      }
      return send(404, JSON.stringify({ error: 'not found' }));
    }
    if (url.pathname.startsWith('/api/')) return send(404, JSON.stringify({ error: 'Not found' }));
    let file = url.pathname === '/poetry' || url.pathname === '/poetry/' ? '/poetry.html' : url.pathname;
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
  await page.waitForSelector('.poem-card', { timeout: 5000 });
  const summary = await page.evaluate(() => ({
    cards: document.querySelectorAll('.poem-card').length,
    navLinks: document.querySelectorAll('.nav-link').length,
    current: document.querySelector('.nav-link.is-current')?.textContent?.trim() || '',
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  assert(summary.cards === 4, `${pathname}: expected 4 poem cards, saw ${summary.cards}`);
  assert(summary.navLinks === 4, `${pathname}: expected 4 nav links, saw ${summary.navLinks}`);
  assert(summary.current.includes('诗文馆'), `${pathname}: expected current nav item 诗文馆, saw ${summary.current}`);
  assert(summary.overflow <= 1, `${pathname}: horizontal overflow of ${summary.overflow}px at desktop width`);
  const progress = await page.evaluate(() => {
    const el = document.getElementById('poetryProgress');
    const bar = el?.querySelector('[role="progressbar"]');
    return {
      exists: Boolean(el),
      text: el?.textContent || '',
      ariaValueNow: bar?.getAttribute('aria-valuenow') || '',
    };
  });
  assert(progress.exists && progress.text.includes('背诵进度'), `${pathname}: expected progress card, saw ${progress.text}`);
  assert(progress.ariaValueNow === '75', `${pathname}: expected 75% progress (3 of 4), saw ${progress.ariaValueNow}`);
  await page.locator('.poem-card summary').first().focus();
  await page.keyboard.press('Enter');
  const expanded = await page.evaluate(() => {
    const details = document.querySelector('.poem-card');
    return { open: details.open, body: details.querySelector('.poem-body')?.textContent || '', audio: details.querySelectorAll('audio').length, link: details.querySelector('a.poem-link')?.getAttribute('href') || '' };
  });
  assert(expanded.open, `${pathname}: keyboard Enter did not expand the card`);
  assert(expanded.body.includes('\n'), `${pathname}: poem line breaks were not preserved`);
  assert(expanded.audio === 1, `${pathname}: expected one safe audio element, saw ${expanded.audio}`);
  assert(expanded.link === 'https://example.test/jingyesi', `${pathname}: unexpected source link ${expanded.link}`);
  const unsafe = await page.evaluate(() => Array.from(document.querySelectorAll('.poem-card')).find((card) => card.textContent.includes('望岳'))?.querySelector('a.poem-link')?.getAttribute('href') || 'none');
  assert(unsafe === 'none', `${pathname}: unsafe javascript: link was rendered as ${unsafe}`);

  // Expand p4 (which has empty body initially) and verify on-demand loading of body, translation, appreciation
  const p4Card = page.locator('.poem-card[data-poem-id="p4"] summary');
  await p4Card.click();
  await page.waitForFunction(() => {
    const el = document.querySelector('.poem-card[data-poem-id="p4"] .poem-body');
    return el && el.textContent.includes('曲项向天歌');
  }, { timeout: 5000 });

  const p4Details = await page.evaluate(() => {
    const card = document.querySelector('.poem-card[data-poem-id="p4"]');
    const subcards = card.querySelectorAll('.poem-subcard');
    return {
      body: card.querySelector('.poem-body')?.textContent || '',
      subcardsCount: subcards.length,
      hasTranslation: card.textContent.includes('译文与注释'),
      hasAppreciation: card.textContent.includes('诗文赏析'),
    };
  });
  assert(p4Details.body.includes('鹅，鹅，鹅'), `${pathname}: expected on-demand loaded poem text`);
  assert(p4Details.subcardsCount === 2, `${pathname}: expected 2 subcards for translation and appreciation, saw ${p4Details.subcardsCount}`);
  assert(p4Details.hasTranslation && p4Details.hasAppreciation, `${pathname}: missing translation or appreciation labels`);

  await page.screenshot({ path: path.join('/tmp', `poetry${pathname.replaceAll('/', '_')}-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
  }));
  assert(mobile.overflow <= 1 && mobile.bodyOverflow <= 1, `${pathname}: horizontal overflow at 390px (${mobile.overflow}/${mobile.bodyOverflow})`);
  await page.screenshot({ path: path.join('/tmp', `poetry${pathname.replaceAll('/', '_') || '_root'}-390.png`) });
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
      await inspectPage(browser, normal.port, '/poetry');
      await inspectPage(browser, normal.port, '/poetry/');
    } finally { await normal.close(); }

    const empty = await startServer('empty');
    try {
      const page = await browser.newPage();
      const failed = [];
      page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) failed.push(`${response.status()} ${response.url()}`); });
      await page.goto(`http://127.0.0.1:${empty.port}/poetry/`, { waitUntil: 'networkidle' });
      const text = await page.locator('#poetryResults').innerText();
      assert(text.includes('书架还空着'), `empty state missing, saw: ${text}`);
      assert(failed.length === 0, `empty state failed requests ${failed.join(' | ')}`);
      await page.close();
    } finally { await empty.close(); }

    const retry = await startServer('retry');
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${retry.port}/poetry/`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#retryButton', { timeout: 5000 });
      await page.click('#retryButton');
      await page.waitForSelector('.poem-card', { timeout: 5000 });
      assert(await page.locator('.poem-card').count() === 4, 'retry did not load the library');
      await page.close();
    } finally { await retry.close(); }
    console.log('OK: /poetry and /poetry/ render, expand by keyboard, and stay overflow-free.');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
