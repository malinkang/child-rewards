import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const DB_A = 'poetry-db-a';
const DB_B = 'poetry-db-b';
const CACHE_DB = 'poetry-db-cache';
const FAIL_DB = 'poetry-db-fail';
const AUTHOR_DB = 'poetry-db-author';
const FIELD_DB = 'poetry-db-fields';

function envFor(databaseId, extra = {}) {
  return { NOTION_TOKEN: 'test-notion-token', NOTION_POETRY_DATABASE_ID: databaseId, ...extra };
}

function request() {
  return new Request('https://example.test/api/poetry', { method: 'GET' });
}

function poemPage(title, order, extra = {}) {
  return {
    id: `page-${title}`,
    archived: false,
    in_trash: false,
    properties: {
      '标题': { type: 'title', title: [{ plain_text: title }] },
      '序号': { type: 'number', number: order },
      ...extra,
    },
  };
}

function queryResponse(results, extra = {}) {
  return Response.json({ results, has_more: false, ...extra });
}

test('paginates every page, sorts numerically and leaves null order last', async (t) => {
  const bodies = [];
  let queryCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/databases/' + DB_A + '/query')) {
      queryCalls += 1;
      bodies.push(JSON.parse(init.body));
      if (queryCalls === 1) {
        return Response.json({ results: [poemPage('丙', 3), poemPage('乙', 2)], has_more: true, next_cursor: 'cursor-2' });
      }
      return queryResponse([poemPage('甲', 1), poemPage('无序号', null)]);
    }
    throw new Error('unexpected fetch ' + url);
  });
  const response = await worker.fetch(request(), envFor(DB_A));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  assert.deepEqual(data.poems.map((poem) => poem.title), ['甲', '乙', '丙', '无序号']);
  assert.deepEqual(bodies.map((body) => body.start_cursor), [undefined, 'cursor-2']);
  assert.equal(bodies[0].page_size, 100);
  assert.deepEqual(bodies[0].sorts, [{ property: '序号', direction: 'ascending' }]);
  assert.equal(queryCalls, 2);
});

test('resolves unique author titles once, bounds concurrency and drops author properties', async (t) => {
  let authorFetches = 0;
  let active = 0;
  let peak = 0;
  const authorStarts = [];
  const authorId = (index) => String(index).repeat(32);
  const authorTitles = new Map([
    [authorId(1), '李白'],
    [authorId(2), '杜甫'],
    [authorId(3), '王维'],
    [authorId(4), '白居易'],
    [authorId(5), '苏轼'],
    [authorId(6), '陆游'],
  ]);
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/databases/' + AUTHOR_DB + '/query')) {
      const relation = (id) => ({ relation: [{ id }] });
      return queryResponse([
        poemPage('静夜思', 1, { '作者': relation(authorId(1)), '朝代': { select: { name: '唐' } } }),
        poemPage('望岳', 2, { '作者': relation(authorId(2)) }),
        poemPage('相思', 3, { '作者': relation(authorId(1)) }),
        poemPage('鹿柴', 4, { '作者': relation(authorId(3)) }),
        poemPage('长恨歌', 5, { '作者': relation(authorId(4)) }),
        poemPage('赤壁赋', 6, { '作者': relation(authorId(5)) }),
        poemPage('示儿', 7, { '作者': relation(authorId(6)) }),
        poemPage('无作者', 8),
      ]);
    }
    const match = url.match(/\/pages\/(\d{32})$/);
    if (!match) throw new Error('unexpected fetch ' + url);
    authorFetches += 1;
    active += 1;
    peak = Math.max(peak, active);
    authorStarts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return Response.json({
      id: match[1],
      properties: {
        '姓名': { type: 'title', title: [{ plain_text: authorTitles.get(match[1]) }] },
        '私密备注': { type: 'rich_text', rich_text: [{ plain_text: 'must not leak' }] },
      },
    });
  });
  const response = await worker.fetch(request(), envFor(AUTHOR_DB));
  const data = await response.json();
  assert.equal(authorFetches, 6);
  assert.ok(peak <= 4, `expected bounded concurrency, saw ${peak}`);
  const gaps = authorStarts.slice(1).map((start, index) => start - authorStarts[index]);
  assert.ok(gaps.every((gap) => gap >= 300), `expected paced author lookups, saw gaps ${gaps.join(',')}`);
  const byTitle = new Map(data.poems.map((poem) => [poem.title, poem]));
  assert.deepEqual(byTitle.get('静夜思').authors, ['李白']);
  assert.deepEqual(byTitle.get('相思').authors, ['李白']);
  assert.deepEqual(byTitle.get('无作者').authors, []);
  assert.deepEqual(Object.keys(byTitle.get('静夜思')).sort(), [
    'audio', 'authors', 'body', 'dynasty', 'grade', 'id', 'link', 'order', 'section', 'stage', 'status', 'title', 'type', 'week',
  ]);
  assert.equal(JSON.stringify(data).includes('must not leak'), false);
});

test('tolerates missing and malformed fields, keeps 复习中 distinct and only allows HTTP(S) links', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/databases/' + FIELD_DB + '/query')) {
      return queryResponse([
        {
          id: 'page-bare',
          archived: false,
          in_trash: false,
          properties: {},
        },
        {
          id: 'page-rich',
          properties: {
            '标题': { type: 'title', title: [{ plain_text: '春晓' }] },
            '原文': { type: 'rich_text', rich_text: [{ plain_text: '春眠不觉晓，\r\n处处闻啼鸟。' }] },
            '学段': { type: 'select', select: { name: '小学' } },
            '年级': { type: 'select', select: { name: '一年级上册' } },
            '板块': { type: 'select', select: { name: '古诗' } },
            '背诵状态': { type: 'status', status: { name: '复习中' } },
            '计划周次': { type: 'rich_text', rich_text: [{ plain_text: '新学第 3 周' }] },
            '朝代': { type: 'select', select: { name: '唐' } },
            '类型': { type: 'multi_select', multi_select: [{ name: '五言绝句' }, { name: '写景' }] },
            '链接': { type: 'url', url: 'javascript:alert(1)' },
            '音频': {
              type: 'files',
              files: [
                { name: 'good.mp3', type: 'external', external: { url: 'https://cdn.example.test/good.mp3' } },
                { name: 'bad.mp3', type: 'external', external: { url: 'http://insecure.example.test/bad.mp3' } },
                { name: 'evil.mp3', type: 'external', external: { url: 'javascript:alert(2)' } },
              ],
            },
          },
        },
        // A number property holding a string, and a select with no name.
        {
          id: 'page-odd',
          properties: {
            '标题': { type: 'title', title: [{ plain_text: '山行' }] },
            '背诵状态': { type: 'select' },
            '计划周次': { type: 'rich_text', rich_text: [{ plain_text: '复习' }] },
            '序号': { type: 'number', number: 'not-a-number' },
          },
        },
        { id: 'page-archived', archived: true, properties: { '标题': { type: 'title', title: [{ plain_text: '已归档' }] } } },
      ]);
    }
    throw new Error('unexpected fetch ' + url);
  });
  const data = await (await worker.fetch(request(), envFor(FIELD_DB))).json();
  const bare = data.poems.find((poem) => poem.id === 'page-bare');
  assert.deepEqual(
    [bare.title, bare.body, bare.stage, bare.grade, bare.section, bare.status, bare.week, bare.dynasty, bare.type, bare.link],
    ['', '', '', '', '', '', '', '', [], ''],
  );
  assert.deepEqual(bare.audio, []);
  const rich = data.poems.find((poem) => poem.id === 'page-rich');
  assert.equal(rich.body, '春眠不觉晓，\n处处闻啼鸟。');
  assert.equal(rich.grade, '一年级上册');
  assert.equal(rich.week, '新学第 3 周');
  assert.deepEqual(rich.type, ['五言绝句', '写景']);
  assert.equal(rich.link, '');
  assert.deepEqual(rich.audio.map((clip) => clip.url), ['https://cdn.example.test/good.mp3', 'http://insecure.example.test/bad.mp3']);
  assert.equal(rich.audio[0].name, 'good.mp3');
  assert.equal(data.poems.some((poem) => poem.title === '已归档'), false);
  const odd = data.poems.find((poem) => poem.id === 'page-odd');
  assert.equal(odd.order, null);
  assert.equal(odd.status, '');
  assert.equal(odd.week, '复习');
  assert.deepEqual(odd.type, []);
  assert.equal(data.stats.total, 3);
  assert.equal(data.stats.mastered, 0);
  assert.deepEqual(data.stats.byStatus.map((entry) => entry.name).sort(), ['复习中']);
  assert.equal(data.stats.byStatus.find((entry) => entry.name === '复习中').count, 1);
});

test('derives mastered totals from observed statuses and keeps 复习中 distinct', async (t) => {
  const MASTERED_DB = 'poetry-db-mastered';
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!url.endsWith('/databases/' + MASTERED_DB + '/query')) throw new Error('unexpected fetch ' + url);
    return queryResponse([
      poemPage('甲', 1, { '背诵状态': { select: { name: '已掌握' } } }),
      poemPage('乙', 2, { '背诵状态': { select: { name: '已背诵' } } }),
      poemPage('丙', 3, { '背诵状态': { select: { name: '复习中' } } }),
      poemPage('丁', 4),
    ]);
  });
  const data = await (await worker.fetch(request(), envFor(MASTERED_DB))).json();
  assert.equal(data.stats.total, 4);
  assert.equal(data.stats.mastered, 2);
  assert.deepEqual([...data.stats.masteredStatuses].sort(), ['已掌握', '已背诵'].sort());
  assert.deepEqual(data.stats.byStatus.map((entry) => entry.name).sort(), ['已掌握', '已背诵', '复习中'].sort());
  assert.equal(data.stats.byStatus.find((entry) => entry.name === '复习中').count, 1);
});

test('serves a bounded public cache and coalesces concurrent reads', async (t) => {
  let queryCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!url.endsWith('/databases/' + CACHE_DB + '/query')) throw new Error('unexpected fetch ' + url);
    queryCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return queryResponse([poemPage('咏鹅', 1)]);
  });
  const env = envFor(CACHE_DB);
  const responses = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env), worker.fetch(request(), env)]);
  assert.equal(queryCalls, 1);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  }
  const warm = await worker.fetch(request(), env);
  assert.equal(warm.status, 200);
  assert.equal(queryCalls, 1);
  const warmData = await warm.json();
  assert.deepEqual(warmData.poems.map((poem) => poem.title), ['咏鹅']);
  assert.ok(typeof warmData.refreshedAt === 'string' && warmData.refreshedAt.length > 0);
});

test('never caches failed loads and isolates cache entries by source configuration', async (t) => {
  let failCalls = 0;
  let succeed = false;
  let otherCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/databases/' + FAIL_DB + '/query')) {
      failCalls += 1;
      if (!succeed) return new Response('upstream exploded', { status: 500 });
      return queryResponse([poemPage('悯农', 1)]);
    }
    if (url.endsWith('/databases/' + DB_B + '/query')) {
      otherCalls += 1;
      return queryResponse([poemPage('登鹳雀楼', 1)]);
    }
    throw new Error('unexpected fetch ' + url);
  });
  const failed = await worker.fetch(request(), envFor(FAIL_DB));
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await failed.json(), { error: '服务暂时不可用，请稍后再试' });
  succeed = true;
  const recovered = await worker.fetch(request(), envFor(FAIL_DB));
  assert.equal(recovered.status, 200);
  assert.equal(failCalls, 2);
  const other = await worker.fetch(request(), envFor(DB_B));
  const otherData = await other.json();
  assert.deepEqual(otherData.poems.map((poem) => poem.title), ['登鹳雀楼']);
  assert.equal(otherCalls, 1);
  // The other source stays cached independently and the failed source keeps its value.
  await worker.fetch(request(), envFor(DB_B));
  assert.equal(otherCalls, 1);
  const againData = await (await worker.fetch(request(), envFor(FAIL_DB))).json();
  assert.deepEqual(againData.poems.map((poem) => poem.title), ['悯农']);
  assert.equal(failCalls, 2);
});

test('retries rate-limited author lookups honouring Retry-After instead of dropping the author', async (t) => {
  const RATE_DB = 'poetry-db-rate';
  const firstAuthor = '9'.repeat(32);
  const secondAuthor = '8'.repeat(32);
  const attempts = new Map();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/databases/' + RATE_DB + '/query')) {
      return queryResponse([
        poemPage('咏柳', 1, { '作者': { relation: [{ id: firstAuthor }] } }),
        poemPage('回乡偶书', 2, { '作者': { relation: [{ id: secondAuthor }] } }),
      ]);
    }
    const match = url.match(/\/pages\/(\d{32})$/);
    if (!match) throw new Error('unexpected fetch ' + url);
    const seen = (attempts.get(match[1]) || 0) + 1;
    attempts.set(match[1], seen);
    // The first author is rate limited once with a zero-second Retry-After;
    // the second fails once with an upstream error, then recovers.
    if (match[1] === firstAuthor && seen === 1) {
      return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
    }
    if (match[1] === secondAuthor && seen === 1) {
      return new Response('server error', { status: 500 });
    }
    const title = match[1] === firstAuthor ? '贺知章' : '贺知章';
    return Response.json({ id: match[1], properties: { '姓名': { type: 'title', title: [{ plain_text: title }] } } });
  });
  const data = await (await worker.fetch(request(), envFor(RATE_DB))).json();
  assert.equal(attempts.get(firstAuthor), 2);
  assert.ok(attempts.get(secondAuthor) >= 2, `expected a retry, saw ${attempts.get(secondAuthor)}`);
  assert.deepEqual(data.poems.map((poem) => poem.authors), [['贺知章'], ['贺知章']]);
});

test('returns a generic error when unconfigured and 404s other methods', async () => {
  const unconfigured = await worker.fetch(request(), { NOTION_TOKEN: 'token' });
  assert.equal(unconfigured.status, 500);
  assert.deepEqual(await unconfigured.json(), { error: '服务暂时不可用，请稍后再试' });
  const missingToken = await worker.fetch(request(), { NOTION_POETRY_DATABASE_ID: DB_A });
  assert.equal(missingToken.status, 500);
  const posted = await worker.fetch(new Request('https://example.test/api/poetry', { method: 'POST', body: '{}' }), envFor(DB_A));
  assert.equal(posted.status, 404);
});

test('prefers NOTION_POETRY_TOKEN when provided and works without NOTION_TOKEN', async (t) => {
  const SEPARATE_DB = 'poetry-db-separate-token';
  const usedTokens = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.includes('/databases/')) {
      const auth = init?.headers?.Authorization || (init?.headers?.get && init.headers.get('Authorization'));
      usedTokens.push(auth);
      return queryResponse([poemPage('独坐敬亭山', 1)]);
    }
    throw new Error('unexpected fetch ' + url);
  });
  const response = await worker.fetch(request(), {
    NOTION_POETRY_TOKEN: 'dedicated-poetry-token',
    NOTION_TOKEN: 'fallback-token',
    NOTION_POETRY_DATABASE_ID: SEPARATE_DB,
  });
  assert.equal(response.status, 200);
  assert.equal(usedTokens[0], 'Bearer dedicated-poetry-token');

  const NO_FALLBACK_DB = 'poetry-db-no-fallback';
  const response2 = await worker.fetch(request(), {
    NOTION_POETRY_TOKEN: 'dedicated-poetry-token',
    NOTION_POETRY_DATABASE_ID: NO_FALLBACK_DB,
  });
  assert.equal(response2.status, 200);
});

test('serves the poetry page asset for /poetry and /poetry/', async () => {
  const requested = [];
  const assets = { fetch: async (assetRequest) => { requested.push(new URL(assetRequest.url).pathname); return new Response('<html></html>', { status: 200 }); } };
  for (const path of ['/poetry', '/poetry/']) {
    const response = await worker.fetch(new Request('https://example.test' + path), { ASSETS: assets });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(requested, ['/poetry.html', '/poetry.html']);
});

test('GET /api/poetry/:recordId/content parses tabs and returns poem text, translation, appreciation', async (t) => {
  const POEM_ID = '3f986019-c92c-814e-b2e3-c6d652b1f91a';
  const TAB_BLOCK_ID = 'tab-block-1';
  const TAB_ORIGIN_ID = 'tab-origin-1';
  const TAB_TRANS_ID = 'tab-trans-1';
  const TAB_APPR_ID = 'tab-appr-1';

  let blockCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    blockCalls += 1;
    if (url.includes(`/blocks/${POEM_ID}/children`)) {
      return Response.json({
        results: [
          { id: 'audio-1', type: 'audio', has_children: false },
          { id: TAB_BLOCK_ID, type: 'tab', has_children: true },
        ],
        has_more: false,
      });
    }
    if (url.includes(`/blocks/${TAB_BLOCK_ID}/children`)) {
      return Response.json({
        results: [
          { id: TAB_ORIGIN_ID, type: 'paragraph', has_children: true, paragraph: { rich_text: [{ plain_text: '原文' }] } },
          { id: TAB_TRANS_ID, type: 'paragraph', has_children: true, paragraph: { rich_text: [{ plain_text: '译文' }] } },
          { id: TAB_APPR_ID, type: 'paragraph', has_children: true, paragraph: { rich_text: [{ plain_text: '赏析' }] } },
        ],
        has_more: false,
      });
    }
    if (url.includes(`/blocks/${TAB_ORIGIN_ID}/children`)) {
      return Response.json({
        results: [
          { id: 'p1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '鹅，鹅，鹅，曲项向天歌。' }] } },
          { id: 'p2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '白毛浮绿水，红掌拨清波。' }] } },
        ],
        has_more: false,
      });
    }
    if (url.includes(`/blocks/${TAB_TRANS_ID}/children`)) {
      return Response.json({
        results: [
          { id: 't1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '一群白鹅在水中畅游。' }] } },
        ],
        has_more: false,
      });
    }
    if (url.includes(`/blocks/${TAB_APPR_ID}/children`)) {
      return Response.json({
        results: [
          { id: 'a1', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '骆宾王七岁时所作。' }] } },
        ],
        has_more: false,
      });
    }
    throw new Error('unexpected fetch ' + url);
  });

  const env = envFor(DB_A);
  const req = new Request(`https://example.test/api/poetry/${POEM_ID}/content`, { method: 'GET' });
  const response = await worker.fetch(req, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/json; charset=utf-8');
  assert(response.headers.get('Cache-Control').includes('public'));

  const data = await response.json();
  assert.equal(data.id, POEM_ID);
  assert.equal(data.text, '鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。');
  assert.equal(data.translation, '一群白鹅在水中畅游。');
  assert.equal(data.appreciation, '骆宾王七岁时所作。');

  // Second call hits cache (blockCalls should not increase)
  const initialCalls = blockCalls;
  const cachedResponse = await worker.fetch(req, env);
  assert.equal(cachedResponse.status, 200);
  const cachedData = await cachedResponse.json();
  assert.equal(cachedData.text, data.text);
  assert.equal(blockCalls, initialCalls);
});

test('GET /api/poetry/:recordId/content validates inputs and handles 400/404/method errors', async (t) => {
  const env = envFor(DB_A);

  // Invalid record ID format (not 32 hex chars)
  const badIdRes = await worker.fetch(new Request('https://example.test/api/poetry/invalid-id/content', { method: 'GET' }), env);
  assert.equal(badIdRes.status, 400);

  // Non-GET method (POST) returns 404
  const postRes = await worker.fetch(new Request('https://example.test/api/poetry/3f986019-c92c-814e-b2e3-c6d652b1f91a/content', { method: 'POST' }), env);
  assert.equal(postRes.status, 404);

  // Missing Notion page returns 404
  const MISSING_ID = '00000000-0000-0000-0000-000000000000';
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.includes(`/blocks/${MISSING_ID}/children`)) {
      return new Response(JSON.stringify({ object: 'error', status: 404 }), { status: 404 });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const notFoundRes = await worker.fetch(new Request(`https://example.test/api/poetry/${MISSING_ID}/content`, { method: 'GET' }), env);
  assert.equal(notFoundRes.status, 404);
});
