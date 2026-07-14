const NOTION_API = 'https://api.notion.com/v1';
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const NO_STORE_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'no-store' };
const GIFT_HEADERS = { ...JSON_HEADERS, 'Cache-Control': 'public, max-age=60, s-maxage=60' };
const AUTH_COOKIE = 'child_rewards_auth';
const AUTH_MAX_AGE = 30 * 24 * 60 * 60;
const failedLogins = new Map();
const recentWrites = new Map();

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
      if (url.pathname === '/api/auth' && request.method === 'GET') {
        return getAuthStatus(request, env);
      }
      if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        return handleWrite(request, () => login(request, env));
      }
      if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return handleWrite(request, () => logout());
      }
      if (url.pathname === '/api/earn' && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorizedWrite(request, env, () => earnTask(request, env)));
      }
      if (url.pathname === '/api/spend' && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorizedWrite(request, env, () => spendStars(request, env)));
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

async function getAuthStatus(request, env) {
  requireAuthConfig(env);
  return json({ authenticated: await isAuthorized(request, env) });
}

async function login(request, env) {
  requireAuthConfig(env);
  const clientKey = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (isLoginBlocked(clientKey)) return json({ error: '尝试次数太多，请 15 分钟后再试', code: 'RATE_LIMITED' }, 429);
  const body = await readJson(request);
  if (!await pinMatches(body.pin, env)) {
    recordLoginFailure(clientKey);
    return json({ error: '家长 PIN 不正确', code: 'PIN_INVALID' }, 401);
  }
  failedLogins.delete(clientKey);
  const cookie = await createAuthCookie(env);
  return Response.json({ authenticated: true }, {
    headers: { ...NO_STORE_HEADERS, 'Set-Cookie': cookie },
  });
}

function logout() {
  return Response.json({ authenticated: false }, {
    headers: {
      ...NO_STORE_HEADERS,
      'Set-Cookie': `${AUTH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
    },
  });
}

async function requireAuthorizedWrite(request, env, action) {
  requireAuthConfig(env);
  if (!await isAuthorized(request, env)) {
    return json({ error: '请先输入家长 PIN 解锁', code: 'AUTH_REQUIRED' }, 401);
  }
  const clientKey = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  if (now - (recentWrites.get(clientKey) || 0) < 2000) {
    return json({ error: '操作太快啦，请稍等一下', code: 'TOO_FAST' }, 429);
  }
  recentWrites.set(clientKey, now);
  trimTimestampMap(recentWrites, now - 60_000);
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
  const [taskPages, recordPages, balance] = await Promise.all([
    queryAll(env.NOTION_TASKS_DATABASE_ID, env, {
      sorts: [
        { property: '排序', direction: 'ascending' },
        { timestamp: 'created_time', direction: 'ascending' },
      ],
    }),
    getRecordPages(env),
    getBalance(env),
  ]);
  const tasks = taskPages.map(mapTask).filter((task) => task.name && task.stars > 0);
  const ledger = recordPages.map(mapLedgerEntry);
  return Response.json({ tasks, ledger, balance }, { headers: NO_STORE_HEADERS });
}

async function earnTask(request, env) {
  requireRewardsConfig(env);
  const body = await readJson(request);
  const taskId = typeof body.taskId === 'string' ? body.taskId : '';
  if (!isNotionId(taskId)) return json({ error: '任务无效' }, 400);

  const taskPage = await notion(`/pages/${taskId}`, env);
  if (taskPage.archived || taskPage.in_trash) return json({ error: '任务已经不存在' }, 400);
  if (taskPage.parent?.database_id?.replaceAll('-', '') !== env.NOTION_TASKS_DATABASE_ID.replaceAll('-', '')) {
    return json({ error: '任务无效' }, 400);
  }
  const task = mapTask(taskPage);
  if (task.stars < 1) return json({ error: '任务无效' }, 400);

  const balanceBefore = await getBalance(env);
  const entry = await createRecord(env, {
    title: task.name,
    type: '获得',
    stars: task.stars,
    taskId,
    reason: task.reason,
  });
  const balance = await waitForBalance(env, balanceBefore + task.stars);
  return Response.json({ entry, balance }, { status: 201, headers: NO_STORE_HEADERS });
}

async function spendStars(request, env) {
  requireRewardsConfig(env);
  const body = await readSpendRequest(request);
  const item = typeof body.item === 'string' ? body.item.trim().slice(0, 120) : '';
  const stars = Number(body.stars);
  const pinKey = `spend:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  if (isLoginBlocked(pinKey)) return json({ error: '尝试次数太多，请 15 分钟后再试', code: 'RATE_LIMITED' }, 429);
  if (!await pinMatches(body.pin, env)) {
    recordLoginFailure(pinKey);
    return json({ error: '兑换需要正确的家长 PIN', code: 'PIN_INVALID' }, 401);
  }
  failedLogins.delete(pinKey);
  if (!item || !Number.isInteger(stars) || stars < 1 || stars > 10000) {
    return json({ error: '兑换内容或星星数量无效' }, 400);
  }
  if (body.files.length > 5) return json({ error: '一次最多上传 5 个文件' }, 400);
  for (const file of body.files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      return json({ error: '只支持图片或视频文件' }, 400);
    }
    if (file.size > 20 * 1024 * 1024) return json({ error: '单个文件不能超过 20 MB' }, 400);
  }

  const balance = await getBalance(env);
  if (stars > balance) return json({ error: `星星还不够，还差 ${stars - balance} 颗` }, 409);

  const media = [];
  for (const file of body.files) media.push(await uploadNotionFile(file, env));
  const entry = await createRecord(env, {
    title: `兑换：${item}`,
    type: '支出',
    stars: -stars,
    reason: item,
    media,
  });
  const updatedBalance = await waitForBalance(env, balance - stars);
  return Response.json({ entry, balance: updatedBalance }, { status: 201, headers: NO_STORE_HEADERS });
}

async function createRecord(env, { title, type, stars, taskId, reason, media = [] }) {
  const now = new Date().toISOString();
  const properties = {
    '记录': titleProperty(title),
    '类型': { select: { name: type } },
    '星星': { number: stars },
    '说明': richTextProperty(reason),
    '时间': { date: { start: now } },
    '余额统计': { relation: [{ id: env.NOTION_BALANCE_PAGE_ID }] },
  };
  if (taskId) properties['任务'] = { relation: [{ id: taskId }] };
  if (media.length) properties['媒体'] = { files: media };

  let page = await notion('/pages', env, {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: env.NOTION_LEDGER_DATABASE_ID }, properties }),
  });
  if (media.length) page = await notion(`/pages/${page.id}`, env);
  return mapLedgerEntry(page);
}

async function uploadNotionFile(file, env) {
  const upload = await notion('/file_uploads', env, {
    method: 'POST',
    headers: { 'Notion-Version': '2025-09-03' },
    body: JSON.stringify({
      mode: 'single_part',
      filename: file.name || 'reward-media',
      content_type: file.type,
    }),
  });
  const form = new FormData();
  form.append('file', file, file.name || 'reward-media');
  await notion(`/file_uploads/${upload.id}/send`, env, {
    method: 'POST',
    headers: { 'Notion-Version': '2025-09-03' },
    body: form,
  });
  return { name: file.name || 'reward-media', type: 'file_upload', file_upload: { id: upload.id } };
}

async function getRecordPages(env) {
  return queryAll(env.NOTION_LEDGER_DATABASE_ID, env, {
    sorts: [
      { property: '时间', direction: 'descending' },
      { timestamp: 'created_time', direction: 'descending' },
    ],
  });
}

async function getBalance(env) {
  const page = await notion(`/pages/${env.NOTION_BALANCE_PAGE_ID}`, env);
  if (page.archived || page.in_trash ||
      page.parent?.database_id?.replaceAll('-', '') !== env.NOTION_BALANCE_DATABASE_ID.replaceAll('-', '')) {
    throw new Error('Balance page is invalid');
  }
  return Number(page.properties?.['当前余额']?.rollup?.number || 0);
}

async function waitForBalance(env, expected) {
  let balance = await getBalance(env);
  for (let attempt = 0; attempt < 8 && balance !== expected; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    balance = await getBalance(env);
  }
  return balance;
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
  const isFormData = init.body instanceof FormData;
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.NOTION_TOKEN}`,
      'Notion-Version': env.NOTION_VERSION || '2022-06-28',
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
    date: properties['时间']?.date?.start || page.created_time,
    media: (properties['媒体']?.files || []).map(mapMedia).filter(Boolean),
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

async function readSpendRequest(request) {
  if (request.headers.get('Content-Type')?.includes('multipart/form-data')) {
    const form = await request.formData();
    return {
      item: form.get('item'),
      stars: form.get('stars'),
      pin: form.get('pin'),
      files: form.getAll('media').filter((value) => value instanceof File && value.size > 0),
    };
  }
  const body = await readJson(request);
  return { ...body, files: [] };
}

function requireConfig(env, databaseId) {
  if (!env.NOTION_TOKEN || !databaseId) throw new Error('Notion is not configured');
}

function requireRewardsConfig(env) {
  if (!env.NOTION_TOKEN || !env.NOTION_TASKS_DATABASE_ID || !env.NOTION_LEDGER_DATABASE_ID ||
      !env.NOTION_BALANCE_DATABASE_ID || !env.NOTION_BALANCE_PAGE_ID) {
    throw new Error('Rewards databases are not configured');
  }
}

function requireAuthConfig(env) {
  if (!env.AUTH_PIN || !env.AUTH_SECRET) throw new Error('Authentication is not configured');
}

async function pinMatches(value, env) {
  const supplied = typeof value === 'string' ? value.trim() : '';
  const [actual, expected] = await Promise.all([sha256(supplied), sha256(env.AUTH_PIN)]);
  return timingSafeEqual(actual, expected);
}

async function createAuthCookie(env) {
  const expires = Math.floor(Date.now() / 1000) + AUTH_MAX_AGE;
  const payload = `v1.${expires}`;
  const signature = await sign(payload, env.AUTH_SECRET);
  return `${AUTH_COOKIE}=${payload}.${signature}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${AUTH_MAX_AGE}`;
}

async function isAuthorized(request, env) {
  const value = readCookie(request, AUTH_COOKIE);
  const match = /^v1\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
  const payload = `v1.${match[1]}`;
  return timingSafeEqual(await sign(payload, env.AUTH_SECRET), match[2]);
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  return (request.headers.get('Cookie') || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return base64Url(bytes);
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

function base64Url(bytes) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function timingSafeEqual(left, right) {
  const a = typeof left === 'string' ? new TextEncoder().encode(left) : left;
  const b = typeof right === 'string' ? new TextEncoder().encode(right) : right;
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index % a.length] || 0) ^ (b[index % b.length] || 0);
  return difference === 0;
}

function isLoginBlocked(key) {
  const entry = failedLogins.get(key);
  if (!entry || entry.resetAt <= Date.now()) return false;
  return entry.count >= 5;
}

function recordLoginFailure(key) {
  const now = Date.now();
  const current = failedLogins.get(key);
  const entry = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + 15 * 60_000 }
    : { ...current, count: current.count + 1 };
  failedLogins.set(key, entry);
  trimTimestampMap(failedLogins, now, (value) => value.resetAt);
}

function trimTimestampMap(map, threshold, getTimestamp = (value) => value) {
  if (map.size < 500) return;
  for (const [key, value] of map) if (getTimestamp(value) < threshold) map.delete(key);
}

function isNotionId(value) {
  return /^[0-9a-f-]{32,36}$/i.test(value);
}

function json(payload, status = 200) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS });
}
