const NOTION_API = 'https://api.notion.com/v1';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const NO_STORE_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'no-store' };
const GIFT_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60, s-maxage=60' };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/gifts' && request.method === 'GET') {
        return getGifts(env);
      }
      if (url.pathname === '/api/rewards' && request.method === 'GET') {
        return getRewards(env);
      }
      if (url.pathname === '/api/earn' && request.method === 'POST') {
        return handleWrite(request, () => earnTask(request, env));
      }
      if (url.pathname === '/api/spend' && request.method === 'POST') {
        return handleWrite(request, () => spendStars(request, env));
      }
      if (url.pathname === '/api/reset-today' && request.method === 'POST') {
        return handleWrite(request, () => resetToday(env));
      }
      if (url.pathname.startsWith('/api/')) {
        return json({ error: 'Not found' }, 404);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error('Worker request failed', error instanceof Error ? error.message : 'unknown_error');
      return json({ error: '服务暂时不可用，请稍后再试' }, 500);
    }
  },
};

async function handleWrite(request, action) {
  const origin = request.headers.get('Origin');
  if (origin !== new URL(request.url).origin) {
    return json({ error: 'Forbidden' }, 403);
  }
  return action();
}

async function getGifts(env) {
  const databaseId = env.NOTION_GIFTS_DATABASE_ID || env.NOTION_DATABASE_ID;
  requireConfig(env, databaseId);
  const pages = await queryAll(databaseId, env, {
    filter: { property: '启用', checkbox: { equals: true } },
    sorts: [
      { property: '排序', direction: 'ascending' },
      { timestamp: 'created_time', direction: 'ascending' },
    ],
  });
  const gifts = pages.map(mapGift).filter((gift) => gift.name && gift.cost > 0);
  return Response.json({ gifts, refreshedAt: new Date().toISOString() }, { headers: GIFT_HEADERS });
}

async function getRewards(env) {
  requireRewardsConfig(env);
  const [taskPages, recordPages] = await Promise.all([
    queryAll(env.NOTION_TASKS_DATABASE_ID, env, {
      filter: { property: '启用', checkbox: { equals: true } },
      sorts: [
        { property: '排序', direction: 'ascending' },
        { timestamp: 'created_time', direction: 'ascending' },
      ],
    }),
    getRecordPages(env),
  ]);
  const tasks = taskPages.map(mapTask).filter((task) => task.name && task.stars > 0);
  const ledger = recordPages.map(mapLedgerEntry);
  return Response.json({ tasks, ledger, balance: sumBalance(ledger) }, { headers: NO_STORE_HEADERS });
}

async function earnTask(request, env) {
  requireRewardsConfig(env);
  const body = await readJson(request);
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!isNotionId(taskId)) return json({ error: '任务无效' }, 400);

  const taskPage = await notion(`/pages/${taskId}`, env);
  if (taskPage.parent?.database_id?.replaceAll('-', '') !== env.NOTION_TASKS_DATABASE_ID.replaceAll('-', '')) {
    return json({ error: '任务无效' }, 400);
  }
  const task = mapTask(taskPage);
  if (!task.active || task.stars < 1) return json({ error: '任务未启用' }, 400);

  const { start, end } = shanghaiDayRange();
  const duplicate = await queryAll(env.NOTION_LEDGER_DATABASE_ID, env, {
    filter: {
      and: [
        { property: '任务', relation: { contains: taskId } },
        { property: '类型', select: { equals: '获得' } },
        { property: '时间', date: { on_or_after: start, before: end } },
      ],
    },
    page_size: 1,
  });
  if (duplicate.length) return json({ error: '这个任务今天已经完成啦' }, 409);

  const ledger = (await getRecordPages(env)).map(mapLedgerEntry);
  const balanceAfter = sumBalance(ledger) + task.stars;
  const entry = await createRecord(env, {
    title: task.name,
    type: '获得',
    stars: task.stars,
    taskId,
    reason: task.reason,
    balanceAfter,
  });
  return Response.json({ entry, balance: balanceAfter }, { status: 201, headers: NO_STORE_HEADERS });
}

async function spendStars(request, env) {
  requireRewardsConfig(env);
  const body = await readJson(request);
  const item = typeof body.item === 'string' ? body.item.trim().slice(0, 120) : '';
  const stars = Number(body.stars);
  if (!item || !Number.isInteger(stars) || stars < 1 || stars > 10000) {
    return json({ error: '兑换内容或星星数量无效' }, 400);
  }

  const ledger = (await getRecordPages(env)).map(mapLedgerEntry);
  const balance = sumBalance(ledger);
  if (stars > balance) return json({ error: `星星还不够，还差 ${stars - balance} 颗` }, 409);

  const balanceAfter = balance - stars;
  const entry = await createRecord(env, {
    title: `兑换：${item}`,
    type: '支出',
    stars: -stars,
    reason: item,
    balanceAfter,
  });
  return Response.json({ entry, balance: balanceAfter }, { status: 201, headers: NO_STORE_HEADERS });
}

async function resetToday(env) {
  requireRewardsConfig(env);
  const { start, end } = shanghaiDayRange();
  const [pages, recordPages] = await Promise.all([
    queryAll(env.NOTION_LEDGER_DATABASE_ID, env, {
    filter: {
      and: [
        { property: '类型', select: { equals: '获得' } },
        { property: '时间', date: { on_or_after: start, before: end } },
      ],
    },
    }),
    getRecordPages(env),
  ]);
  const ledger = recordPages.map(mapLedgerEntry);
  const resetStars = pages.reduce((sum, page) => sum + Number(page.properties?.['星星']?.number || 0), 0);
  if (sumBalance(ledger) - resetStars < 0) {
    return json({ error: '今天已有兑换记录，重置后余额会不足' }, 409);
  }
  await Promise.all(pages.map((page) => notion(`/pages/${page.id}`, env, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  })));
  return Response.json({ removed: pages.length, balance: sumBalance(ledger) - resetStars }, { headers: NO_STORE_HEADERS });
}

async function createRecord(env, { title, type, stars, taskId, reason, balanceAfter }) {
  const now = new Date().toISOString();
  const properties = {
    '记录': titleProperty(title),
    '类型': { select: { name: type } },
    '星星': { number: stars },
    '说明': richTextProperty(reason),
    '时间': { date: { start: now } },
    '余额': { number: balanceAfter },
  };
  if (taskId) properties['任务'] = { relation: [{ id: taskId }] };

  const page = await notion('/pages', env, {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: env.NOTION_LEDGER_DATABASE_ID }, properties }),
  });
  return mapLedgerEntry(page);
}

async function getRecordPages(env) {
  return queryAll(env.NOTION_LEDGER_DATABASE_ID, env, {
    sorts: [
      { property: '时间', direction: 'descending' },
      { timestamp: 'created_time', direction: 'descending' },
    ],
  });
}

async function queryAll(databaseId, env, query) {
  const results = [];
  let cursor;
  do {
    const body = { page_size: 100, ...query };
    if (cursor) body.start_cursor = cursor;
    const data = await notion(`/databases/${databaseId}/query`, env, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    results.push(...data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function notion(path, env, init = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': env.NOTION_VERSION || '2022-06-28',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Notion ${response.status}: ${error.code || 'unknown_error'}`);
  }
  return response.json();
}

function mapGift(page) {
  const properties = page.properties || {};
  return {
    id: page.id,
    name: plainText(properties['礼品']?.title),
    cost: properties['星星']?.number || 0,
    category: properties['分类']?.select?.name || '奖励',
    description: plainText(properties['说明']?.rich_text),
    media: (properties['媒体']?.files || []).map(mapMedia).filter(Boolean),
  };
}

function mapTask(page) {
  const properties = page.properties || {};
  return {
    id: page.id,
    name: plainText(properties['任务']?.title),
    stars: properties['星星']?.number || 0,
    reason: plainText(properties['说明']?.rich_text),
    active: properties['启用']?.checkbox === true,
    icon: mapIcon(page.icon),
  };
}

function mapLedgerEntry(page) {
  const properties = page.properties || {};
  const type = properties['类型']?.select?.name === '支出' ? 'spend' : 'earn';
  return {
    id: page.id,
    type,
    title: plainText(properties['记录']?.title),
    reason: plainText(properties['说明']?.rich_text),
    stars: properties['星星']?.number || 0,
    taskId: properties['任务']?.relation?.[0]?.id || '',
    balanceAfter: properties['余额']?.number || 0,
    date: properties['时间']?.date?.start || page.created_time,
  };
}

function mapIcon(icon) {
  if (icon?.type === 'emoji') return { type: 'emoji', value: icon.emoji };
  if (icon?.type === 'external') return { type: 'image', value: icon.external.url };
  if (icon?.type === 'file') return { type: 'image', value: icon.file.url };
  return null;
}

function mapMedia(file) {
  const url = file.type === 'file' ? file.file?.url : file.external?.url;
  if (!url) return null;
  const name = file.name || '';
  return {
    name,
    type: /\.(mp4|mov|m4v|webm|ogg)(?:$|\?)/i.test(name) ? 'video' : 'image',
    url,
  };
}

function sumBalance(ledger) {
  return ledger.reduce((sum, entry) => sum + Number(entry.stars || 0), 0);
}

function shanghaiDayRange(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const startMs = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)) - 8 * 60 * 60 * 1000;
  return { start: new Date(startMs).toISOString(), end: new Date(startMs + 86400000).toISOString() };
}

function titleProperty(value) {
  return { title: [{ type: 'text', text: { content: value } }] };
}

function richTextProperty(value) {
  return value ? { rich_text: [{ type: 'text', text: { content: value } }] } : { rich_text: [] };
}

function plainText(items = []) {
  return items.map((item) => item.plain_text || '').join('').trim();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function requireConfig(env, databaseId) {
  if (!env.NOTION_TOKEN || !databaseId) throw new Error('Notion is not configured');
}

function requireRewardsConfig(env) {
  if (!env.NOTION_TOKEN || !env.NOTION_TASKS_DATABASE_ID || !env.NOTION_LEDGER_DATABASE_ID) {
    throw new Error('Rewards databases are not configured');
  }
}

function isNotionId(value) {
  return /^[0-9a-f-]{32,36}$/i.test(value);
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS });
}
