import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchSourceRecords, normalizeCard } from '../scripts/qiqixue.mjs';
import { main, syncQiqixue } from '../scripts/sync-qiqixue.mjs';

const cookie = 'test-cookie-private';
const token = 'test-sync-token-private';
const date = '2026-09-18';
const credentials = { cookie, token, sleep: async () => {} };
const env = { QIQIXUE_COOKIE: cookie, QIQIXUE_SYNC_TOKEN: token };

function card(overrides = {}) {
  return {
    id: 101, userId: 42, learnDate: date,
    learnStart: `${date} 22:28:19`, learnEnd: `${date} 22:44:45`,
    content: JSON.stringify({ book_name: 'Private fixture book' }), studyType: 1, isWifiPen: null,
    ...overrides,
  };
}

function day(dayDate = date, cards) {
  return {
    date: dayDate, isWifiPen: true,
    cards: cards ?? [card({
      id: Number(dayDate.replaceAll('-', '')), learnDate: dayDate,
      learnStart: `${dayDate} 22:28:19`, learnEnd: `${dayDate} 22:44:45`,
    })],
  };
}

function page(days = [day()], total = days.length, pageNum = 1) {
  return { ret: 0, code: 0, data: { total, pageNum, pageSize: 10, dayList: days } };
}

function mockFetch(responses) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    assert.ok(calls.length <= responses.length, 'Unexpected request');
    const response = responses[calls.length - 1];
    if (response instanceof Error) throw response;
    if (typeof response === 'function') return response(url, options);
    return response instanceof Response ? response : Response.json(response);
  };
  return { fetchImpl, calls };
}

async function runMain(responses, options = {}) {
  const { fetchImpl, calls } = mockFetch(responses);
  const stdout = [];
  const stderr = [];
  const summaries = [];
  const code = await main({
    argv: [], env, fetchImpl, sleep: async () => {},
    stdout: (value) => stdout.push(value), stderr: (value) => stderr.push(value),
    appendSummary: (...args) => summaries.push(args), ...options,
  });
  return { code, stdout, stderr, summaries, calls };
}

test('normalizes only the six allowed fields with Beijing seconds and inherited pen mode', () => {
  assert.deepEqual(normalizeCard(card({ ignored: 'source-only metadata' }), day()), {
    sourceId: 'qiqixue:42:101', book: 'Private fixture book',
    start: `${date}T22:28:19+08:00`, end: `${date}T22:44:45+08:00`, seconds: 986, wifiPen: true,
  });
  assert.equal(normalizeCard(card({ isWifiPen: false }), day()).wifiPen, false);
  assert.equal(normalizeCard(card({ isWifiPen: true }), { ...day(), isWifiPen: false }).wifiPen, true);
  assert.equal(normalizeCard(card(), { ...day(), isWifiPen: false }).wifiPen, false);
  assert.equal(normalizeCard(card({ userId: '9007199254740993', id: '123' }), day()).sourceId,
    'qiqixue:9007199254740993:123');
});

test('uses fixed Beijing time across leap-day midnight and host time zones', () => {
  const leapDay = day('2024-02-29');
  const leapCard = card({
    learnDate: leapDay.date, learnStart: '2024-02-29 23:59:59', learnEnd: '2024-03-01 00:00:01',
  });
  assert.equal(normalizeCard(leapCard, leapDay).seconds, 2);
  assert.equal(Date.parse(normalizeCard(leapCard, leapDay).end), Date.parse('2024-02-29T16:00:01Z'));
  const moduleUrl = new URL('../scripts/qiqixue.mjs', import.meta.url).href;
  const script = `import { normalizeCard } from ${JSON.stringify(moduleUrl)};
    process.stdout.write(JSON.stringify(normalizeCard(${JSON.stringify(leapCard)}, ${JSON.stringify(leapDay)})));`;
  const results = ['UTC', 'America/Los_Angeles', 'Asia/Shanghai'].map((TZ) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { TZ }, encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.equal(child.stderr, '');
    return child.stdout;
  });
  assert.equal(new Set(results).size, 1);
});

test('rejects impossible calendar dates, times, reversed intervals and mismatched dates', () => {
  for (const value of ['2026-02-29', '2024-02-30', '2026-04-31', '2026-00-01', '2026-13-01', '2026-09-00']) {
    assert.throws(() => normalizeCard(card({
      learnDate: value, learnStart: `${value} 12:00:00`, learnEnd: `${value} 12:01:00`,
    }), day(value)), { code: 'SOURCE_DATE_INVALID' });
  }
  for (const overrides of [
    { learnStart: `${date} 24:00:00` }, { learnEnd: `${date} 22:60:00` },
    { learnEnd: `${date} 22:44:60` }, { learnStart: `${date}T22:28:19Z` },
    { learnStart: `${date} 22:28:19+08:00` }, { learnStart: `${date} 2:28:19` },
    { learnDate: '2026-09-17' }, { learnStart: '2026-09-17 22:28:19' },
    { learnEnd: `${date} 22:28:18` }, { learnEnd: null },
  ]) assert.throws(() => normalizeCard(card(overrides), day()), { code: 'SOURCE_DATE_INVALID' });
});

test('rejects unsupported study types and malformed card metadata', () => {
  for (const studyType of [0, 2, '1', null, undefined]) {
    assert.throws(() => normalizeCard(card({ studyType }), day()), { code: 'SOURCE_STUDY_TYPE_UNSUPPORTED' });
  }
  for (const overrides of [
    { id: 0 }, { id: -1 }, { id: 1.5 }, { id: Number.MAX_SAFE_INTEGER + 1 },
    { id: '01' }, { userId: null }, { userId: 'private-metadata' },
    { content: null }, { content: '{}' }, { content: 'invalid private body' },
    { content: '[]' }, { content: 'null' }, { content: '{"book_name":7}' },
    { content: '{"book_name":"   "}' }, { content: JSON.stringify({ book_name: 'a'.repeat(501) }) },
    { content: JSON.stringify({ book_name: 'bad\nname' }) }, { isWifiPen: 1 }, { isWifiPen: undefined },
  ]) assert.throws(() => normalizeCard(card(overrides), day()), { code: 'SOURCE_SCHEMA_INVALID' });
});

test('paginates by distinct days while preserving all same-day sessions', async () => {
  const days = Array.from({ length: 11 }, (_, i) => day(`2026-09-${String(18 - i).padStart(2, '0')}`));
  days[0].cards.push(card());
  const { fetchImpl, calls } = mockFetch([page(days.slice(0, 10), 11), page(days.slice(10), 11, 2)]);
  const result = await fetchSourceRecords({ cookie, fetchImpl });
  assert.equal(result.days, 11);
  assert.equal(result.records.length, 12);
  assert.equal(new Set(result.records.map((record) => record.sourceId)).size, 12);
  assert.deepEqual(calls.map(({ url }) => url.search), ['?pageNum=1&pageSize=10', '?pageNum=2&pageSize=10']);
  for (const { url, options } of calls) {
    assert.equal(url.origin, 'https://m.qiqixue.com');
    assert.equal(url.pathname, '/qqx/parentCenter/growth/summaryList');
    assert.equal(options.method, 'GET');
    assert.deepEqual(options.headers, { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.qiqixue.com/' });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('deduplicates identical source IDs without merging distinct sessions or users', async () => {
  const { fetchImpl } = mockFetch([page([day(date, [card(), card(), card({ id: 102 }), card({ userId: 43 })])])]);
  const result = await fetchSourceRecords({ cookie, fetchImpl });
  assert.equal(result.records.length, 3);
  assert.deepEqual(result.records.map(({ sourceId }) => sourceId), ['qiqixue:42:101', 'qiqixue:42:102', 'qiqixue:43:101']);
  const conflict = mockFetch([page([day(date, [card(), card({ learnEnd: `${date} 22:44:46` })])])]);
  await assert.rejects(syncQiqixue({ ...credentials, fetchImpl: conflict.fetchImpl, dryRun: false }),
    { code: 'SOURCE_RECORD_CONFLICT' });
  assert.equal(conflict.calls.length, 1);
});

test('an empty source fails without destination requests', async () => {
  const { fetchImpl, calls } = mockFetch([page([], 0)]);
  await assert.rejects(syncQiqixue({ ...credentials, fetchImpl }), { code: 'SOURCE_PAGINATION_INCOMPLETE' });
  assert.equal(calls.length, 1);
});

test('incomplete, repeated or changing pagination fails before any destination request', async (t) => {
  const cases = [
    ['empty page', [page([day()], 2), page([], 2, 2)], 'SOURCE_PAGINATION_INCOMPLETE'],
    ['repeated day', [page([day()], 2), page([day()], 2, 2)], 'SOURCE_PAGINATION_REPEATED'],
    ['repeated within page', [page([day(), day()], 2)], 'SOURCE_PAGINATION_REPEATED'],
    ['changed total', [page([day()], 2), page([day('2026-09-17')], 3, 2)], 'SOURCE_TOTAL_CHANGED'],
    ['excess days', [page([day(), day('2026-09-17')], 1)], 'SOURCE_PAGINATION_INCOMPLETE'],
    ['late invalid card', [page([day()], 2), page([day('2026-09-17', [card({ studyType: 9, learnDate: '2026-09-17' })])], 2, 2)], 'SOURCE_STUDY_TYPE_UNSUPPORTED'],
    ['late auth error', [page([day()], 2), { code: 401, ret: -1 }], 'SOURCE_AUTH_EXPIRED'],
  ];
  for (const [name, responses, code] of cases) await t.test(name, async () => {
    const { fetchImpl, calls } = mockFetch(responses);
    await assert.rejects(syncQiqixue({ ...credentials, fetchImpl, dryRun: false }), { code });
    assert.ok(calls.every(({ url }) => url.origin === 'https://m.qiqixue.com'));
  });
});

test('rejects malformed pagination envelopes and empty day cards', async () => {
  const invalid = [null, [], {}, { ...page(), data: null }, ...[
    { total: -1 }, { total: 1.5 }, { total: '1' }, { total: Number.MAX_SAFE_INTEGER + 1 },
    { pageNum: 2 }, { pageNum: '1' }, { pageSize: 9 }, { dayList: null }, { dayList: [null] },
    { dayList: [day(date, [])] }, { dayList: [{ ...day(), isWifiPen: null }] },
    { dayList: Array.from({ length: 11 }, () => day()) },
  ].map((data) => ({ ...page(), data: { ...page().data, ...data } }))];
  for (const response of invalid) {
    const { fetchImpl, calls } = mockFetch([response]);
    await assert.rejects(syncQiqixue({ ...credentials, fetchImpl, dryRun: false }));
    assert.equal(calls.length, 1);
  }
});

test('HTTP 200 authentication errors and HTTP failures fail safely', async () => {
  for (const response of [
    { ret: 0, code: 401 }, { ret: 401, code: 0 }, { ret: -1, code: '401' },
    new Response('private login HTML', { status: 401 }), new Response('private body', { status: 403 }),
  ]) {
    const result = await runMain([response]);
    assert.equal(result.code, 1);
    assert.deepEqual(result.stderr, ['SOURCE_AUTH_EXPIRED']);
    assert.deepEqual(result.stdout, []);
    assert.equal(result.calls.length, 1);
  }
  const cases = [
    [{ ret: -1, code: 500, message: cookie }, 'SOURCE_REJECTED'],
    [new Response('<html>private body</html>'), 'SOURCE_INVALID_JSON'],
    [Response.json({ message: cookie }, { status: 500 }), 'SOURCE_HTTP_ERROR'],
    [new Response('private body', { status: 302, headers: { Location: 'https://example.test/' } }), 'SOURCE_HTTP_ERROR'],
    [new Error(`private request failure ${cookie}`), 'SOURCE_REQUEST_FAILED'],
  ];
  for (const [response, code] of cases) {
    const result = await runMain([response]);
    assert.equal(result.code, 1);
    assert.deepEqual(result.stderr, [code]);
  }
});

test('source and destination requests have bounded timeouts without retries', async () => {
  const stall = (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  for (const kind of ['SOURCE', 'DESTINATION']) {
    const { fetchImpl, calls } = mockFetch(kind === 'SOURCE' ? [stall] : [page(), stall]);
    // Keep the test alive while AbortSignal's unref'ed timeout fires.
    await Promise.all([
      assert.rejects(syncQiqixue({ ...credentials, fetchImpl, timeoutMs: 10 }), { code: `${kind}_TIMEOUT` }),
      delay(30),
    ]);
    assert.equal(calls.length, kind === 'SOURCE' ? 1 : 2);
  }
});

test('paces sequential requests and keeps source and destination secrets separated', async () => {
  const events = [];
  const sourcePage = page([day(date, [card(), card({ id: 102 }), card()])]);
  const mock = mockFetch([sourcePage, Response.json({ status: 'created' }, { status: 201 }), { status: 'exists' }]);
  let inFlight = false;
  const result = await syncQiqixue({
    ...credentials, dryRun: false,
    sleep: async (ms) => { assert.equal(inFlight, false); events.push(`sleep:${ms}`); },
    fetchImpl: async (url, options) => {
      assert.equal(inFlight, false);
      inFlight = true;
      events.push(options.method);
      await delay(1);
      const response = await mock.fetchImpl(url, options);
      inFlight = false;
      return response;
    },
  });
  assert.deepEqual(result, { days: 1, records: 2, created: 1, exists: 1, would_create: 0 });
  assert.deepEqual(events, ['GET', 'sleep:750', 'POST', 'sleep:750', 'POST']);
  for (const { url, options } of mock.calls.slice(1)) {
    assert.equal(url.href, 'https://child.malinkang.com/api/sync/qiqixue');
    assert.deepEqual(options.headers, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    const body = JSON.parse(options.body);
    assert.deepEqual(Object.keys(body).sort(), ['dryRun', 'record']);
    assert.equal(body.dryRun, false);
    assert.deepEqual(Object.keys(body.record).sort(), ['book', 'end', 'seconds', 'sourceId', 'start', 'wifiPen']);
    assert.ok(!options.body.includes(cookie) && !options.body.includes(token));
  }
});

test('dry run compares every record, sends dryRun true and reports only counts', async () => {
  const result = await runMain([
    page([day(date, [card(), card({ id: 102 })])]), { status: 'would_create' }, { status: 'exists' },
  ], { argv: ['--dry-run=true'], env: { ...env, GITHUB_STEP_SUMMARY: '/mock/summary' } });
  assert.equal(result.code, 0);
  assert.deepEqual(result.stderr, []);
  assert.deepEqual(result.stdout, ['days=1 records=2 created=0 exists=1 would_create=1']);
  assert.deepEqual(result.summaries, [['/mock/summary', `${result.stdout[0]}\n`, 'utf8']]);
  assert.ok(result.calls.slice(1).every(({ options }) => JSON.parse(options.body).dryRun === true));
});

test('CLI defaults to dry run and accepts an explicit write flag only', async () => {
  for (const argv of [[], ['--dry-run'], ['--dry-run=true'], ['--dry-run=false']]) {
    const result = await runMain([page(), { status: 'exists' }], { argv });
    assert.equal(result.code, 0);
    assert.equal(JSON.parse(result.calls[1].options.body).dryRun, argv[0] !== '--dry-run=false');
  }
  for (const argv of [['--dry-run=private'], ['--unknown'], ['--dry-run', '--dry-run=false']]) {
    const result = await runMain([], { argv });
    assert.equal(result.code, 1);
    assert.deepEqual(result.stderr, ['INVALID_ARGUMENTS']);
    assert.equal(result.calls.length, 0);
  }
});

test('destination errors are allowlisted, stop immediately and never retry a create', async () => {
  const cases = [
    [Response.json({ code: 'SYNC_RECONCILIATION_REQUIRED', detail: cookie }, { status: 409 }), 'SYNC_RECONCILIATION_REQUIRED'],
    [Response.json({ code: 'NOTION_CREATE_FAILED', detail: token }, { status: 502 }), 'NOTION_CREATE_FAILED'],
    [Response.json({ code: 'PRIVATE_SOURCE_ID_AND_BOOK', detail: cookie }, { status: 500 }), 'DESTINATION_HTTP_ERROR'],
    [Response.json({ code: 'PRIVATE_SOURCE_ID_AND_BOOK' }), 'DESTINATION_RESPONSE_INVALID'],
    [Response.json({ code: 'SYNC_UNAUTHORIZED' }, { status: 401 }), 'SYNC_UNAUTHORIZED'],
    ...['TASK_READ_FAILED', 'TASK_INVALID', 'MANUAL_RECORD_REVIEW_REQUIRED'].map((code) => [
      Response.json({ code, detail: cookie }, { status: 409 }), code,
    ]),
    [new Error(`private ${token}`), 'DESTINATION_REQUEST_FAILED'],
    [new Response('private HTML'), 'DESTINATION_INVALID_JSON'],
    [{ status: 'linked' }, 'DESTINATION_RESPONSE_INVALID'],
    [{ status: 'would_create' }, 'DESTINATION_RESPONSE_INVALID'],
    [{ status: 'exists', code: 'UNKNOWN_PRIVATE_CODE' }, 'DESTINATION_RESPONSE_INVALID'],
    [Response.json({ status: 'created' }, { status: 202 }), 'DESTINATION_HTTP_ERROR'],
  ];
  for (const [response, code] of cases) {
    const result = await runMain([page([day(date, [card(), card({ id: 102 })])]), response], { argv: ['--dry-run=false'] });
    assert.equal(result.code, 1);
    assert.deepEqual(result.stdout, []);
    assert.deepEqual(result.stderr, [code]);
    assert.deepEqual(result.summaries, []);
    assert.equal(result.calls.length, 2);
  }
  const result = await runMain([page(), { status: 'created' }]);
  assert.equal(result.code, 1);
  assert.deepEqual(result.stderr, ['DESTINATION_RESPONSE_INVALID']);
});

test('missing secrets fail before fetching and summary failures expose only a fixed code', async () => {
  for (const [missingEnv, code] of [
    [{}, 'MISSING_QIQIXUE_COOKIE'],
    [{ ...env, QIQIXUE_COOKIE: '   ' }, 'MISSING_QIQIXUE_COOKIE'],
    [{ QIQIXUE_COOKIE: cookie }, 'MISSING_QIQIXUE_SYNC_TOKEN'],
    [{ ...env, QIQIXUE_SYNC_TOKEN: '' }, 'MISSING_QIQIXUE_SYNC_TOKEN'],
  ]) {
    const result = await runMain([], { env: missingEnv });
    assert.equal(result.code, 1);
    assert.deepEqual(result.stderr, [code]);
    assert.equal(result.calls.length, 0);
  }
  const result = await runMain([page(), { status: 'exists' }], {
    env: { ...env, GITHUB_STEP_SUMMARY: '/mock/summary' },
    appendSummary: () => { throw new Error(`private ${cookie}`); },
  });
  assert.equal(result.code, 1);
  assert.deepEqual(result.stderr, ['SUMMARY_WRITE_FAILED']);
});

test('imports have no CLI side effects and CLI failures exit nonzero without a stack trace', () => {
  const scriptUrl = new URL('../scripts/sync-qiqixue.mjs', import.meta.url);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    globalThis.fetch = () => { throw new Error('Import must not fetch'); };
    await import(${JSON.stringify(scriptUrl.href)});
  `], { env: {}, encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
  const cli = spawnSync(process.execPath, [scriptUrl.pathname], { env: {}, encoding: 'utf8' });
  assert.equal(cli.status, 1);
  assert.equal(cli.stdout, '');
  assert.equal(cli.stderr, 'MISSING_QIQIXUE_COOKIE\n');
});
