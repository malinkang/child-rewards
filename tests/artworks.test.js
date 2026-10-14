import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const DB_A = 'artworks-db-a';
const DS_A = '62621208-c307-4879-bda4-1984012eef4c';
const HOME_CHILD_A = 'a'.repeat(32);
const HOME_CHILD_B = 'b'.repeat(32);
const HOME_CHILD_C = 'c'.repeat(32);

function envFor(databaseId, extra = {}) {
  return {
    NOTION_TOKEN: 'test-notion-token',
    NOTION_ARTWORKS_DATABASE_ID: databaseId,
    NOTION_ARTWORKS_DATA_SOURCE_ID: DS_A,
    ...extra,
  };
}

function listRequest() {
  return new Request('https://example.test/api/artworks', { method: 'GET' });
}

function mediaRequest(pageId, kind, init = {}) {
  return new Request(`https://example.test/api/artwork-media/${pageId}/${kind}`, { method: 'GET', ...init });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function artworkPage(id, options = {}) {
  const {
    title,
    order,
    description,
    date,
    image,
    audio,
    parentDatabaseId = DB_A,
    parentDataSourceId,
    archived = false,
    inTrash = false,
  } = options;
  const properties = {
    '作品': { type: 'title', title: title === undefined ? [] : [{ plain_text: title }] },
  };
  if (order !== undefined) properties['序号'] = { type: 'number', number: order };
  if (description !== undefined) properties['描述'] = { type: 'rich_text', rich_text: [{ plain_text: description }] };
  if (date !== undefined) properties['上传时间'] = { type: 'date', date: date === null ? null : { start: date } };
  if (image !== undefined) properties['图片'] = { type: 'files', files: image === null ? [] : [image] };
  if (audio !== undefined) properties['音频'] = { type: 'files', files: audio === null ? [] : [audio] };
  const parent = parentDataSourceId ? { data_source_id: parentDataSourceId } : { database_id: parentDatabaseId };
  return { id, archived, in_trash: inTrash, parent, properties };
}

function imageBlock(url) {
  return { id: 'blk-image', type: 'image', image: { type: 'file', file: { url } } };
}

function audioBlock(url) {
  return { id: 'blk-audio', type: 'audio', audio: { type: 'external', external: { url } } };
}

function fileProperty(url, name) {
  return { name, type: 'file', file: { url } };
}

test('paginates, sorts by 序号 with null last, and prefers page-body blocks over property files', async (t) => {
  const bodies = [];
  let queryCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith(`/databases/${DB_A}/query`)) {
      queryCalls += 1;
      bodies.push(JSON.parse(init.body));
      if (queryCalls === 1) {
        return Response.json({
          results: [artworkPage(HOME_CHILD_B, {
            title: '多乐作品 02',
            order: 2,
            date: '2026-10-14T08:18:00.000Z',
            parentDataSourceId: DS_A,
            image: fileProperty('https://cdn.example.test/stale-02.png', 'stale-02.png'),
          })],
          has_more: true,
          next_cursor: 'cursor-2',
        });
      }
      return Response.json({
        results: [
          artworkPage(HOME_CHILD_A, {
            title: '多乐作品 01',
            order: 1,
            description: '黑暗黑开始就是海草。',
            date: '2026-10-13T15:30:00.000Z',
            image: fileProperty('https://cdn.example.test/stale-01.png', 'stale-01.png'),
            audio: fileProperty('https://cdn.example.test/stale-01.mp3', 'stale-01.mp3'),
          }),
          artworkPage(HOME_CHILD_C, {
            title: '多乐作品 03',
            order: null,
            image: fileProperty('https://cdn.example.test/fallback-03.png', 'fallback-03.png'),
          }),
        ],
        has_more: false,
      });
    }
    const parsed = new URL(url);
    if (parsed.pathname.startsWith('/v1/blocks/')) {
      const pageId = parsed.pathname.split('/')[3];
      if (pageId === HOME_CHILD_A) {
        return Response.json({
          results: [
            imageBlock('https://cdn.example.test/rotated-01.png?sig=r1'),
            { id: 'blk-note', type: 'paragraph', paragraph: {} },
            audioBlock('https://cdn.example.test/story-01.m4a?sig=a1'),
          ],
          has_more: false,
        });
      }
      if (pageId === HOME_CHILD_B) {
        return Response.json({
          results: [imageBlock('https://cdn.example.test/rotated-02.png?sig=r2')],
          has_more: false,
        });
      }
      return Response.json({ results: [], has_more: false });
    }
    throw new Error('unexpected fetch ' + url);
  });

  const response = await worker.fetch(listRequest(), envFor(DB_A));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, s-maxage=60');
  const data = await response.json();
  assert.deepEqual(data.artworks.map((artwork) => artwork.title), ['多乐作品 01', '多乐作品 02', '多乐作品 03']);
  assert.deepEqual(bodies.map((body) => body.start_cursor), [undefined, 'cursor-2']);
  assert.equal(bodies[0].page_size, 100);
  assert.deepEqual(bodies[0].sorts, [{ property: '序号', direction: 'ascending' }]);
  const [one, two, three] = data.artworks;
  assert.equal(one.description, '黑暗黑开始就是海草。');
  assert.equal(one.date, '2026-10-13T15:30:00.000Z');
  assert.equal(one.image, `/api/artwork-media/${HOME_CHILD_A}/image`);
  assert.equal(one.audio, `/api/artwork-media/${HOME_CHILD_A}/audio`);
  assert.equal(two.image, `/api/artwork-media/${HOME_CHILD_B}/image`);
  assert.equal(two.audio, null);
  assert.equal(three.order, null);
  assert.equal(three.image, `/api/artwork-media/${HOME_CHILD_C}/image`);
  assert.equal(JSON.stringify(data).includes('cdn.example.test'), false);
  assert.deepEqual(data.stats, { count: 3, withDescription: 1, withAudio: 1 });
  assert.ok(typeof data.refreshedAt === 'string' && data.refreshedAt.length > 0);
});

test('maps malformed rows defensively and never leaks archived artworks', async (t) => {
  const FIELD_DB = 'artworks-db-fields';
  const bareId = '1'.repeat(32);
  const oddId = '2'.repeat(32);
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/databases/${FIELD_DB}/query`) {
      return Response.json({
        results: [
          { id: bareId, archived: false, in_trash: false, properties: {} },
          artworkPage(oddId, {
            title: '山行',
            order: 'not-a-number',
            date: 'not-a-date',
            image: { name: 'evil.png', type: 'external', external: { url: 'javascript:alert(1)' } },
          }),
          artworkPage('3'.repeat(32), { title: '已归档', archived: true }),
          artworkPage('4'.repeat(32), { title: '回收站', inTrash: true }),
        ],
        has_more: false,
      });
    }
    if (parsed.pathname.startsWith('/v1/blocks/')) return Response.json({ results: [], has_more: false });
    throw new Error('unexpected fetch ' + url);
  });
  const data = await (await worker.fetch(listRequest(), envFor(FIELD_DB))).json();
  assert.equal(data.artworks.length, 2);
  const bare = data.artworks.find((artwork) => artwork.id === bareId);
  assert.deepEqual([bare.title, bare.description, bare.date, bare.image, bare.audio], ['', '', null, null, null]);
  assert.equal(bare.order, null);
  const odd = data.artworks.find((artwork) => artwork.id === oddId);
  assert.equal(odd.date, null);
  assert.equal(odd.image, null);
  assert.equal(odd.order, null);
  assert.equal(data.artworks.some((artwork) => artwork.title === '已归档' || artwork.title === '回收站'), false);
  assert.deepEqual(data.stats, { count: 2, withDescription: 0, withAudio: 0 });
});

test('streams artwork media through the proxy without leaking Notion URLs', async (t) => {
  const PROXY_DB = 'artworks-db-proxy';
  const pageId = '5'.repeat(32);
  const imageFetch = 'https://cdn.example.test/final-01.png?signature=top-secret';
  const calls = { page: 0, blocks: 0, cdn: 0 };
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/pages/${pageId}`) {
      calls.page += 1;
      return Response.json(artworkPage(pageId, { title: '多乐作品 01', parentDatabaseId: PROXY_DB }));
    }
    if (parsed.pathname === `/v1/blocks/${pageId}/children`) {
      calls.blocks += 1;
      return Response.json({ results: [imageBlock(imageFetch)], has_more: false });
    }
    if (url === imageFetch) {
      calls.cdn += 1;
      return new Response('PNGBYTES', { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const env = envFor(PROXY_DB);
  const first = await worker.fetch(mediaRequest(pageId, 'image'), env);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Cache-Control'), 'public, max-age=300, s-maxage=3600');
  assert.equal(first.headers.get('Content-Type'), 'image/png');
  assert.equal(await first.text(), 'PNGBYTES');
  assert.equal(JSON.stringify([...first.headers]).includes('top-secret'), false);
  const second = await worker.fetch(mediaRequest(pageId, 'image'), env);
  assert.equal(second.status, 200);
  // Page and block lookups are reused from the 30-minute media cache.
  assert.equal(calls.page, 1);
  assert.equal(calls.blocks, 1);
  assert.equal(calls.cdn, 2);
});

test('forwards Range, derives audio content type and rejects pages outside the artworks database', async (t) => {
  const RANGE_DB = 'artworks-db-range';
  const pageId = '6'.repeat(32);
  const audioUrl = 'https://cdn.example.test/story-06.m4a?sig=x';
  let rangeHeader = '';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/pages/${pageId}`) {
      return Response.json(artworkPage(pageId, { title: '多乐作品 06', parentDatabaseId: RANGE_DB }));
    }
    if (parsed.pathname === `/v1/blocks/${pageId}/children`) {
      return Response.json({ results: [audioBlock(audioUrl)], has_more: false });
    }
    if (url === audioUrl) {
      rangeHeader = new Headers(init?.headers).get('Range') || '';
      const response = new Response('PART', { status: 206, headers: { 'Content-Range': 'bytes 0-3/64', 'Accept-Ranges': 'bytes' } });
      response.headers.delete('Content-Type');
      return response;
    }
    throw new Error('unexpected fetch ' + url);
  });
  const response = await worker.fetch(mediaRequest(pageId, 'audio', { headers: { Range: 'bytes=0-3' } }), envFor(RANGE_DB));
  assert.equal(response.status, 206);
  assert.equal(rangeHeader, 'bytes=0-3');
  assert.equal(response.headers.get('Content-Type'), 'audio/mp4');
  assert.equal(response.headers.get('Content-Range'), 'bytes 0-3/64');
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(await response.text(), 'PART');
});

test('media lookups reject foreign, archived and empty pages', async (t) => {
  const GUARD_DB = 'artworks-db-guard';
  const foreign = '7'.repeat(32);
  const archived = '8'.repeat(32);
  const empty = '9'.repeat(32);
  let blocksCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/pages/${foreign}`) {
      return Response.json(artworkPage(foreign, { title: '外来页', parentDatabaseId: 'f'.repeat(32) }));
    }
    if (parsed.pathname === `/v1/pages/${archived}`) {
      return Response.json(artworkPage(archived, { title: '已归档', parentDatabaseId: GUARD_DB, archived: true }));
    }
    if (parsed.pathname === `/v1/pages/${empty}`) {
      return Response.json(artworkPage(empty, { title: '无媒体', parentDatabaseId: GUARD_DB }));
    }
    if (parsed.pathname.startsWith('/v1/blocks/')) {
      blocksCalls += 1;
      return Response.json({ results: [], has_more: false });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const env = envFor(GUARD_DB);
  const foreignResponse = await worker.fetch(mediaRequest(foreign, 'image'), env);
  assert.equal(foreignResponse.status, 404);
  assert.deepEqual(await foreignResponse.json(), { error: '作品不存在', code: 'NOT_FOUND' });
  const archivedResponse = await worker.fetch(mediaRequest(archived, 'image'), env);
  assert.equal(archivedResponse.status, 404);
  const emptyResponse = await worker.fetch(mediaRequest(empty, 'image'), env);
  assert.equal(emptyResponse.status, 404);
  assert.deepEqual(await emptyResponse.json(), { error: '媒体不存在', code: 'MEDIA_NOT_FOUND' });
  // Only the in-database, active, media-less page reaches the block lookup.
  assert.equal(blocksCalls, 1);
  const invalid = await worker.fetch(new Request('https://example.test/api/artwork-media/not-a-page/image'), env);
  assert.equal(invalid.status, 404);
});

test('serves a bounded cache, coalesces concurrent reads and never caches failures', async (t) => {
  const CACHE_DB = 'artworks-db-cache';
  const FAIL_DB = 'artworks-db-fail';
  const pageId = 'd'.repeat(32);
  let cacheQueries = 0;
  let failCalls = 0;
  let succeed = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/databases/${CACHE_DB}/query`) {
      cacheQueries += 1;
      await sleep(10);
      return Response.json({ results: [artworkPage(pageId, { title: '多乐作品 07', order: 7 })], has_more: false });
    }
    if (parsed.pathname === `/v1/databases/${FAIL_DB}/query`) {
      failCalls += 1;
      if (!succeed) return new Response('upstream exploded', { status: 500 });
      return Response.json({ results: [artworkPage('e'.repeat(32), { title: '恢复' })], has_more: false });
    }
    if (parsed.pathname.startsWith('/v1/blocks/')) return Response.json({ results: [], has_more: false });
    throw new Error('unexpected fetch ' + url);
  });
  const env = envFor(CACHE_DB);
  const responses = await Promise.all([worker.fetch(listRequest(), env), worker.fetch(listRequest(), env), worker.fetch(listRequest(), env)]);
  for (const response of responses) assert.equal(response.status, 200);
  assert.equal(cacheQueries, 1);
  const warm = await worker.fetch(listRequest(), env);
  assert.equal(warm.status, 200);
  assert.equal(cacheQueries, 1);

  const failed = await worker.fetch(listRequest(), envFor(FAIL_DB));
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { error: '服务暂时不可用，请稍后再试' });
  succeed = true;
  const recovered = await worker.fetch(listRequest(), envFor(FAIL_DB));
  assert.equal(recovered.status, 200);
  assert.equal(failCalls, 2);
});

test('isolates a failing block lookup to one artwork and retries rate limits', async (t) => {
  const ISO_DB = 'artworks-db-isolation';
  const okPage = '0'.repeat(32);
  const badPage = '1'.repeat(32);
  const ratePage = '2'.repeat(32);
  const attempts = new Map();
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === `/v1/databases/${ISO_DB}/query`) {
      return Response.json({
        results: [
          artworkPage(okPage, { title: '正常', order: 1, image: fileProperty('https://cdn.example.test/ok-fallback.png', 'ok.png') }),
          artworkPage(badPage, { title: '坏页', order: 2, image: fileProperty('https://cdn.example.test/bad-fallback.png', 'bad.png') }),
          artworkPage(ratePage, { title: '限流页', order: 3, image: fileProperty('https://cdn.example.test/rate-fallback.png', 'rate.png') }),
        ],
        has_more: false,
      });
    }
    if (parsed.pathname.startsWith('/v1/blocks/')) {
      const pageId = parsed.pathname.split('/')[3];
      attempts.set(pageId, (attempts.get(pageId) || 0) + 1);
      if (pageId === badPage) return new Response('broken', { status: 500 });
      if (pageId === ratePage && attempts.get(pageId) === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } });
      }
      return Response.json({ results: [imageBlock(`https://cdn.example.test/${pageId}.png`)], has_more: false });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const response = await worker.fetch(listRequest(), envFor(ISO_DB));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.artworks.map((artwork) => artwork.title), ['正常', '坏页', '限流页']);
  assert.equal(attempts.get(badPage), 3);
  assert.equal(attempts.get(ratePage), 2);
  for (const artwork of data.artworks) assert.equal(typeof artwork.image, 'string');
});

test('requires configuration, prefers a dedicated token and serves the gallery assets', async (t) => {
  const unconfigured = await worker.fetch(listRequest(), { NOTION_TOKEN: 'token' });
  assert.equal(unconfigured.status, 500);
  assert.deepEqual(await unconfigured.json(), { error: '服务暂时不可用，请稍后再试' });
  const missingToken = await worker.fetch(listRequest(), { NOTION_ARTWORKS_DATABASE_ID: DB_A });
  assert.equal(missingToken.status, 500);
  const posted = await worker.fetch(new Request('https://example.test/api/artworks', { method: 'POST', body: '{}' }), envFor(DB_A));
  assert.equal(posted.status, 404);

  const TOKEN_DB = 'artworks-db-token';
  const FALLBACK_DB = 'artworks-db-token-fallback';
  const usedTokens = new Map();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/query') && parsed.pathname.startsWith('/v1/databases/')) {
      const databaseId = parsed.pathname.split('/')[3];
      usedTokens.set(databaseId, new Headers(init?.headers).get('Authorization'));
      return Response.json({ results: [], has_more: false });
    }
    throw new Error('unexpected fetch ' + url);
  });
  const dedicated = await worker.fetch(listRequest(), {
    NOTION_ARTWORKS_TOKEN: 'artworks-token',
    NOTION_TOKEN: 'fallback-token',
    NOTION_ARTWORKS_DATABASE_ID: TOKEN_DB,
  });
  assert.equal(dedicated.status, 200);
  assert.equal(usedTokens.get(TOKEN_DB), 'Bearer artworks-token');
  const fallback = await worker.fetch(listRequest(), {
    NOTION_TOKEN: 'fallback-token',
    NOTION_ARTWORKS_DATABASE_ID: FALLBACK_DB,
  });
  assert.equal(fallback.status, 200);
  assert.equal(usedTokens.get(FALLBACK_DB), 'Bearer fallback-token');

  const requested = [];
  const assets = { fetch: async (assetRequest) => { requested.push(new URL(assetRequest.url).pathname); return new Response('<html></html>', { status: 200 }); } };
  for (const path of ['/gallery', '/gallery/']) {
    const response = await worker.fetch(new Request('https://example.test' + path), { ASSETS: assets });
    assert.equal(response.status, 200);
  }
  assert.deepEqual(requested, ['/gallery.html', '/gallery.html']);
});
