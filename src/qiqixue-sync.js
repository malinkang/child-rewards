const HEADERS = { 'Cache-Control': 'no-store' };
const MAX_BODY_BYTES = 8192;

function reply(value, status = 200) {
  return Response.json(value, { status, headers: HEADERS });
}

function failure(code, status = 502) {
  return reply({ code }, status);
}

// Hash both tokens to fixed-length byte arrays before comparing them.
async function tokenMatches(actual, expected) {
  const hash = (value) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  const aa = new Uint8Array(a);
  const bb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i];
  return diff === 0;
}

function isBeijingTimestamp(value) {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms + 8 * 3600_000).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function validLearningRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const allowed = ['sourceId', 'book', 'start', 'end', 'seconds', 'wifiPen'];
  if (Object.keys(record).length !== allowed.length || Object.keys(record).some((key) => !allowed.includes(key))) return false;
  return typeof record.sourceId === 'string' && /^qiqixue:[1-9]\d{0,19}:[1-9]\d{0,19}$/.test(record.sourceId)
    && typeof record.book === 'string' && record.book.trim().length > 0 && record.book.length <= 500
    && !/[\u0000-\u001f\u007f]/.test(record.book)
    && isBeijingTimestamp(record.start) && isBeijingTimestamp(record.end)
    && Number.isSafeInteger(record.seconds) && record.seconds >= 0
    && record.seconds === (Date.parse(record.end) - Date.parse(record.start)) / 1000
    && typeof record.wifiPen === 'boolean';
}

async function readLimitedJson(request) {
  if (!request.body) throw new Error('INVALID_BODY');
  const reader = request.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('INVALID_BODY');
    }
    chunks.push(value);
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(data));
}

export async function handleQiqixueSync(request, env) {
  if (!env.QIQIXUE_SYNC_TOKEN || env.QIQIXUE_SYNC_TOKEN.length < 32 || !env.QIQIXUE_IMPORTS
      || !env.NOTION_LEDGER_DATABASE_ID || !env.NOTION_TOKEN || !env.NOTION_TASKS_DATABASE_ID
      || !env.NOTION_QIQIXUE_TASK_ID || !env.NOTION_BALANCE_PAGE_ID) return failure('SYNC_NOT_CONFIGURED', 503);
  const authorization = request.headers.get('Authorization') || '';
  if (request.headers.has('Origin') || !authorization.startsWith('Bearer ') || authorization.length > 512
      || !await tokenMatches(authorization.slice(7), env.QIQIXUE_SYNC_TOKEN)) return failure('SYNC_UNAUTHORIZED', 401);
  let body;
  try { body = await readLimitedJson(request); } catch { return failure('INVALID_BODY', 400); }
  if (!body || Object.keys(body).sort().join(',') !== 'dryRun,record'
      || typeof body.dryRun !== 'boolean' || !validLearningRecord(body.record)) return failure('INVALID_RECORD', 400);
  try {
    const id = env.QIQIXUE_IMPORTS.idFromName(`${env.NOTION_LEDGER_DATABASE_ID}:${body.record.sourceId}`);
    // Only validated learning fields reach the object; no browser/Notion/source credentials are forwarded.
    return await env.QIQIXUE_IMPORTS.get(id).fetch(new Request('https://sync.internal/import', {
      method: 'POST', body: JSON.stringify(body),
    }));
  } catch { return failure('SYNC_UNAVAILABLE', 503); }
}

const text = (value) => [{ type: 'text', text: { content: value } }];
const normalizeId = (value) => String(value || '').replaceAll('-', '');

function learningProperties(record, task, env) {
  return {
    '记录': { title: text(task.name) },
    '类型': { select: { name: '获得' } },
    '星星': { number: task.stars },
    '任务': { relation: [{ id: env.NOTION_QIQIXUE_TASK_ID }] },
    '余额统计': { relation: [{ id: env.NOTION_BALANCE_PAGE_ID }] },
    '时间': { date: { start: record.start } },
    '来源 ID': { rich_text: text(record.sourceId) },
    '说明': { rich_text: text(`阅读牛津树：${record.book}`) },
    '备注': { rich_text: text(`奇奇学${record.wifiPen ? '点读笔' : 'App'}\n开始：${record.start}\n结束：${record.end}\n时长：${record.seconds} 秒`) },
  };
}

export class QiqixueImport {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.queue = Promise.resolve();
  }

  async notion(path, body) {
    return fetch(`https://api.notion.com/v1${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${this.env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      // Workerd supports manual/follow only; rejecting non-2xx below prevents redirects.
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
  }

  owns(page, sourceId) {
    return normalizeId(page.parent?.database_id) === normalizeId(this.env.NOTION_LEDGER_DATABASE_ID)
      && (page.properties?.['来源 ID']?.rich_text || []).map((item) => item.plain_text ?? item.text?.content ?? '').join('') === sourceId;
  }

  async fetch(request) {
    // A per-source promise queue avoids the 30s blockConcurrencyWhile limit during upstream I/O.
    // Durable create intents below protect against resets, including a reset after Notion commits.
    const result = this.queue.then(async () => {
      try {
        const { record, dryRun } = await request.json();
        if (!validLearningRecord(record) || typeof dryRun !== 'boolean') return failure('INVALID_RECORD', 400);
        return await this.import(record, dryRun);
      } catch (error) {
        const name = ['TypeError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(error?.name) ? error.name : 'Error';
        console.error('Qiqixue sync exception', name, this.phase || 'input');
        return failure('NOTION_UNAVAILABLE');
      }
    });
    this.queue = result.catch(() => {});
    return result;
  }

  async import(record, dryRun) {
    this.phase = 'storage_read';
    const previous = await this.ctx.storage.get('state');
    if (previous?.pageId) {
      const response = await this.notion(`/pages/${previous.pageId}`);
      if (!response.ok) return failure('NOTION_READ_FAILED');
      const page = await response.json();
      if (!this.owns(page, record.sourceId)) return failure('SOURCE_CONFLICT', 409);
      // Respect a user's archive decision; do not resurrect known imported pages.
      return reply({ status: 'exists' });
    }
    this.phase = 'source_lookup';
    const response = await this.notion(`/databases/${this.env.NOTION_LEDGER_DATABASE_ID}/query`, {
      filter: { property: '来源 ID', rich_text: { equals: record.sourceId } }, page_size: 2,
    });
    if (!response.ok) return failure('NOTION_READ_FAILED');
    this.phase = 'source_lookup_decode';
    const data = await response.json();
    if (!Array.isArray(data.results) || typeof data.has_more !== 'boolean') return failure('NOTION_INVALID_RESPONSE');
    if (data.results.length > 1 || data.has_more) return failure('SOURCE_CONFLICT', 409);
    if (data.results.length === 1) {
      const page = data.results[0];
      if (!page.id || !this.owns(page, record.sourceId)) return failure('SOURCE_CONFLICT', 409);
      if (!dryRun) await this.ctx.storage.put('state', { pageId: page.id });
      return reply({ status: 'exists' });
    }
    // A timeout can happen after Notion commits. Keep the durable intent until a query finds the page.
    // Never blindly re-create an unresolved request, even after an object restart.
    if (previous?.pending) return failure('SYNC_RECONCILIATION_REQUIRED', 409);
    const taskResponse = await this.notion(`/pages/${this.env.NOTION_QIQIXUE_TASK_ID}`);
    if (!taskResponse.ok) return failure('TASK_READ_FAILED');
    const taskPage = await taskResponse.json();
    const task = {
      name: (taskPage.properties?.['任务']?.title || []).map((item) => item.plain_text ?? item.text?.content ?? '').join(''),
      stars: taskPage.properties?.['星星']?.number,
    };
    if (taskPage.archived || taskPage.in_trash || normalizeId(taskPage.parent?.database_id) !== normalizeId(this.env.NOTION_TASKS_DATABASE_ID)
        || !task.name || task.name.length > 500 || !Number.isSafeInteger(task.stars) || task.stars <= 0) return failure('TASK_INVALID', 409);
    const date = record.start.slice(0, 10);
    const dayEnd = new Date(Date.parse(`${date}T00:00:00+08:00`) + 24 * 3600_000).toISOString();
    const manualResponse = await this.notion(`/databases/${this.env.NOTION_LEDGER_DATABASE_ID}/query`, {
      page_size: 1,
      filter: { and: [
        { property: '任务', relation: { contains: this.env.NOTION_QIQIXUE_TASK_ID } },
        { property: '类型', select: { equals: '获得' } },
        { property: '来源 ID', rich_text: { is_empty: true } },
        { property: '时间', date: { on_or_after: `${date}T00:00:00+08:00` } },
        { property: '时间', date: { before: dayEnd } },
      ] },
    });
    if (!manualResponse.ok) return failure('NOTION_READ_FAILED');
    const manual = await manualResponse.json();
    if (!Array.isArray(manual.results) || typeof manual.has_more !== 'boolean') return failure('NOTION_INVALID_RESPONSE');
    // Generic manual rewards have no book/source ID. Require reconciliation rather than double-awarding.
    if (manual.results.length || manual.has_more) return failure('MANUAL_RECORD_REVIEW_REQUIRED', 409);
    if (dryRun) return reply({ status: 'would_create' });
    await this.ctx.storage.put('state', { pending: true });
    const created = await this.notion('/pages', {
      parent: { database_id: this.env.NOTION_LEDGER_DATABASE_ID },
      icon: { type: 'emoji', emoji: '⭐' }, properties: learningProperties(record, task, this.env),
    });
    if (!created.ok) {
      // These statuses explicitly reject the write; transient/unknown outcomes retain the intent.
      if ([400, 401, 403, 404, 429].includes(created.status)) await this.ctx.storage.delete('state');
      return failure('NOTION_CREATE_FAILED');
    }
    const page = await created.json();
    if (!page.id || !this.owns(page, record.sourceId)) return failure('NOTION_INVALID_RESPONSE');
    await this.ctx.storage.put('state', { pageId: page.id });
    return reply({ status: 'created' }, 201);
  }
}
