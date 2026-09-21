import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { QiqixueImport, validLearningRecord } from '../src/qiqixue-sync.js';

const record = { sourceId: 'qiqixue:123:456', book: 'A Book', start: '2026-09-18T23:59:50+08:00', end: '2026-09-19T00:00:10+08:00', seconds: 20, wifiPen: true };
const env = { QIQIXUE_SYNC_TOKEN: 'test-machine-token-'.repeat(3), NOTION_TOKEN: 'test-notion-token', NOTION_LEDGER_DATABASE_ID: 'db-123', NOTION_TASKS_DATABASE_ID: 'tasks-db', NOTION_QIQIXUE_TASK_ID: 'task-123', NOTION_BALANCE_PAGE_ID: 'balance-123' };
function request(body = { record, dryRun: false }, headers = {}) {
  return new Request('https://example.test/api/sync/qiqixue', { method: 'POST', body: JSON.stringify(body), headers });
}
function page(overrides = {}) {
  return { id: 'page-123', parent: { database_id: env.NOTION_LEDGER_DATABASE_ID }, properties: { '来源 ID': { rich_text: [{ plain_text: record.sourceId }] } }, ...overrides };
}
function taskPage(overrides = {}) {
  return { id: env.NOTION_QIQIXUE_TASK_ID, parent: { database_id: env.NOTION_TASKS_DATABASE_ID }, properties: { '任务': { title: [{ plain_text: '读 1本牛津树' }] }, '星星': { number: 2 } }, ...overrides };
}
function mockNotion(t, handler) {
  t.mock.method(globalThis, 'fetch', async (url, init) => url.endsWith('/pages/task-123') ? Response.json(taskPage()) : handler(url, init));
}
function state() {
  const values = new Map();
  let queue = Promise.resolve();
  return {
    values,
    storage: {
      get: async (key) => values.get(key),
      put: async (key, value) => values.set(key, value),
      delete: async (key) => values.delete(key),
    },
    blockConcurrencyWhile(fn) {
      const result = queue.then(fn);
      queue = result.catch(() => {});
      return result;
    },
  };
}

test('validates Beijing calendar, duration and a bounded allowlist of learning properties', () => {
  assert.equal(validLearningRecord(record), true);
  for (const change of [
    { seconds: 0 }, { seconds: -1 }, { seconds: '20' }, { wifiPen: null }, { book: '' }, { book: 'x'.repeat(501) },
    { book: 'x\ny' }, { sourceId: 'bad' }, { sourceId: 'qiqixue:0:1' }, { stars: 1 },
    { start: '2026-02-30T23:59:50+08:00' }, { start: '2026-09-18T23:59:50Z' }, { start: '2026-09-18T24:59:50+08:00' },
  ]) assert.equal(validLearningRecord({ ...record, ...change }), false);
  assert.equal(validLearningRecord({ ...record, end: record.start, seconds: 0 }), true);
});

test('machine endpoint rejects missing credentials, browser origins, invalid/oversize payloads before forwarding', async () => {
  let calls = 0;
  const bindings = { ...env, QIQIXUE_IMPORTS: { idFromName: () => 'id', get: () => ({ fetch: async () => { calls++; return Response.json({ status: 'exists' }); } }) } };
  assert.equal((await worker.fetch(request(), bindings)).status, 401);
  assert.equal((await worker.fetch(request(undefined, { Authorization: 'Bearer wrong' }), bindings)).status, 401);
  const headers = { Authorization: `Bearer ${env.QIQIXUE_SYNC_TOKEN}` };
  assert.equal((await worker.fetch(request(undefined, { ...headers, Origin: 'https://example.test' }), bindings)).status, 401);
  for (const body of [{ record }, { record, dryRun: 'false' }, { record, dryRun: false, databaseId: 'elsewhere' }, { record: { ...record, stars: 1 }, dryRun: false }, { record: { ...record, book: 'x'.repeat(9000) }, dryRun: false }]) {
    assert.equal((await worker.fetch(request(body, headers), bindings)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(request(undefined, headers), bindings)).status, 200);
  assert.equal(calls, 1);
  assert.equal((await worker.fetch(request(undefined, headers), { ...bindings, QIQIXUE_SYNC_TOKEN: '' })).status, 503);
  // The scoped credential grants no access to browser write routes.
  assert.equal((await worker.fetch(new Request('https://example.test/api/earn', { method: 'POST', headers }), bindings)).status, 403);
});

test('creates only one learning page across concurrent calls and a restart, preserving source times and deriving stars and balance relation from configured task', async (t) => {
  const ctx = state();
  let creates = 0;
  mockNotion(t, async (url, init) => {
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, `Bearer ${env.NOTION_TOKEN}`);
    if (url.endsWith('/query')) return Response.json({ results: [], has_more: false });
    if (url.endsWith('/pages')) {
      creates++;
      const data = JSON.parse(init.body);
      assert.equal(data.parent.database_id, env.NOTION_LEDGER_DATABASE_ID);
      assert.equal(data.properties['时间'].date.start, record.start);
      assert.ok(data.properties['备注'].rich_text[0].text.content.includes(record.end));
      assert.ok(data.properties['备注'].rich_text[0].text.content.includes('20 秒'));
      assert.equal(data.properties['说明'].rich_text[0].text.content, '阅读牛津树：A Book');
      assert.equal(data.properties['星星'].number, 2);
      assert.deepEqual(data.properties['任务'].relation, [{ id: env.NOTION_QIQIXUE_TASK_ID }]);
      assert.deepEqual(data.properties['余额统计'].relation, [{ id: env.NOTION_BALANCE_PAGE_ID }]);
      return Response.json(page());
    }
    return Response.json(page());
  });
  const importer = new QiqixueImport(ctx, env);
  const results = await Promise.all([importer.fetch(request()), importer.fetch(request())]);
  assert.deepEqual(await Promise.all(results.map((r) => r.json())), [{ status: 'created' }, { status: 'exists' }]);
  assert.equal((await (await new QiqixueImport(ctx, env).fetch(request())).json()).status, 'exists');
  assert.equal(creates, 1);
});

test('dry run does not create Notion pages or durable state; recognizes connector backfills', async (t) => {
  const ctx = state();
  let existing = false;
  mockNotion(t, async (url) => {
    assert.match(url, /\/query$/);
    return Response.json({ results: existing ? [page()] : [], has_more: false });
  });
  const importer = new QiqixueImport(ctx, env);
  assert.equal((await (await importer.fetch(request({ record, dryRun: true }))).json()).status, 'would_create');
  existing = true;
  assert.equal((await (await importer.fetch(request({ record, dryRun: true }))).json()).status, 'exists');
  assert.equal(ctx.values.size, 0);
  assert.equal((await (await importer.fetch(request())).json()).status, 'exists');
  assert.equal(ctx.values.get('state').pageId, 'page-123');
});

test('ambiguous write is never blindly repeated after timeout/restart; query can reconcile it later', async (t) => {
  const ctx = state();
  let creates = 0;
  let visible = false;
  mockNotion(t, async (url) => {
    if (url.endsWith('/query')) return Response.json({ results: visible ? [page()] : [], has_more: false });
    creates++;
    throw new Error('sensitive upstream detail');
  });
  assert.deepEqual(await (await new QiqixueImport(ctx, env).fetch(request())).json(), { code: 'NOTION_UNAVAILABLE' });
  assert.deepEqual(ctx.values.get('state'), { pending: true });
  assert.deepEqual(await (await new QiqixueImport(ctx, env).fetch(request())).json(), { code: 'SYNC_RECONCILIATION_REQUIRED' });
  visible = true;
  assert.deepEqual(await (await new QiqixueImport(ctx, env).fetch(request())).json(), { status: 'exists' });
  assert.equal(creates, 1);
});

test('explicit create rejection allows next run, duplicates and read errors never create pages', async (t) => {
  const ctx = state();
  let scenario = 'rejected';
  mockNotion(t, async (url) => {
    if (url.endsWith('/query')) {
      if (scenario === 'failed') return new Response('private', { status: 403 });
      if (scenario === 'invalid') return Response.json({});
      if (scenario === 'duplicate') return Response.json({ results: [page(), page({ id: 'other' })], has_more: false });
      return Response.json({ results: [], has_more: false });
    }
    assert.equal(scenario, 'rejected');
    return new Response('private', { status: 429 });
  });
  const importer = new QiqixueImport(ctx, env);
  assert.deepEqual(await (await importer.fetch(request())).json(), { code: 'NOTION_CREATE_FAILED' });
  assert.equal(ctx.values.size, 0);
  for (const [value, code] of [['failed', 'NOTION_READ_FAILED'], ['invalid', 'NOTION_INVALID_RESPONSE'], ['duplicate', 'SOURCE_CONFLICT']]) {
    scenario = value;
    assert.deepEqual(await (await importer.fetch(request())).json(), { code });
    assert.equal(ctx.values.size, 0);
  }
});

test('known pages respect archives and reject wrong ownership rather than recreating or overwriting', async (t) => {
  const ctx = state();
  await ctx.storage.put('state', { pageId: 'page-123' });
  let current = page({ archived: true });
  mockNotion(t, async (url) => {
    assert.match(url, /\/pages\/page-123$/);
    return Response.json(current);
  });
  const importer = new QiqixueImport(ctx, env);
  assert.deepEqual(await (await importer.fetch(request())).json(), { status: 'exists' });
  current = page({ parent: { database_id: 'different' } });
  assert.deepEqual(await (await importer.fetch(request())).json(), { code: 'SOURCE_CONFLICT' });
});

test('rejects inactive/foreign tasks and manual same-day rewards before awarding any stars', async (t) => {
  let currentTask = taskPage({ archived: true });
  let manual = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/pages/task-123')) return Response.json(currentTask);
    assert.match(url, /\/query$/);
    const query = JSON.parse(init.body);
    if (query.filter.and) {
      assert.deepEqual(query.filter.and[0], { property: '任务', relation: { contains: env.NOTION_QIQIXUE_TASK_ID } });
      assert.deepEqual(query.filter.and[3], { property: '时间', date: { on_or_after: '2026-09-18T00:00:00+08:00' } });
      assert.deepEqual(query.filter.and[4], { property: '时间', date: { before: '2026-09-18T16:00:00.000Z' } });
      return Response.json({ results: manual ? [page()] : [], has_more: false });
    }
    return Response.json({ results: [], has_more: false });
  });
  const ctx = state();
  const importer = new QiqixueImport(ctx, env);
  assert.deepEqual(await (await importer.fetch(request())).json(), { code: 'TASK_INVALID' });
  currentTask = taskPage({ parent: { database_id: 'foreign-db' } });
  assert.deepEqual(await (await importer.fetch(request())).json(), { code: 'TASK_INVALID' });
  currentTask = taskPage();
  manual = true;
  assert.deepEqual(await (await importer.fetch(request())).json(), { code: 'MANUAL_RECORD_REVIEW_REQUIRED' });
  assert.equal(ctx.values.size, 0);
});
