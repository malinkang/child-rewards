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
      if (url.pathname === '/api/classes' && request.method === 'GET') {
        return requireAuthorized(request, env, () => getClasses(url, env));
      }
      if (url.pathname === '/api/classes' && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorizedWrite(request, env, () => createClassRecord(request, env)));
      }
      if (url.pathname === '/api/class-uploads/start' && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorized(request, env, () => startClassUpload(request, env)));
      }
      const classUploadPartMatch = url.pathname.match(/^\/api\/class-uploads\/([0-9a-f-]{32,36})\/parts\/(\d+)$/i);
      if (classUploadPartMatch && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorized(request, env, () => sendClassUploadPart(request, env, classUploadPartMatch[1], Number(classUploadPartMatch[2]))));
      }
      const classUploadCompleteMatch = url.pathname.match(/^\/api\/class-uploads\/([0-9a-f-]{32,36})\/complete$/i);
      if (classUploadCompleteMatch && request.method === 'POST') {
        return handleWrite(request, () => requireAuthorized(request, env, () => completeClassUpload(request, env, classUploadCompleteMatch[1])));
      }
      if (url.pathname === '/api/class-avatar' && request.method === 'GET') {
        return requireAuthorized(request, env, () => proxyProfileAvatar(request, env));
      }
      const courseIconMatch = url.pathname.match(/^\/api\/class-course-icon\/([0-9a-f-]{32,36})$/i);
      if (courseIconMatch && request.method === 'GET') {
        return requireAuthorized(request, env, () => proxyCourseIcon(request, env, courseIconMatch[1]));
      }
      const classMediaMatch = url.pathname.match(/^\/api\/class-media\/([0-9a-f-]{32,36})\/(\d+)$/i);
      if (classMediaMatch && request.method === 'GET') {
        return requireAuthorized(request, env, () => proxyClassMedia(request, env, classMediaMatch[1], Number(classMediaMatch[2])));
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
      if (url.pathname === '/classes' || url.pathname === '/classes/') {
        return env.ASSETS.fetch(new Request(new URL('/classes.html', request.url), request));
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

async function requireAuthorized(request, env, action) {
  requireAuthConfig(env);
  if (!await isAuthorized(request, env)) {
    return json({ error: '请先输入家长 PIN 解锁', code: 'AUTH_REQUIRED' }, 401);
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

async function getClasses(url, env) {
  requireClassesConfig(env);
  const currentYear = Number(shanghaiDateParts().year);
  const year = Number(url.searchParams.get('year') || currentYear);
  if (!Number.isInteger(year) || year < 2022 || year > currentYear + 1) {
    return json({ error: '年份无效', code: 'INVALID_YEAR' }, 400);
  }
  const { start, end } = shanghaiYearRange(year);
  const [profilePage, coursePages, recordPages] = await Promise.all([
    notion(`/pages/${env.NOTION_CHILD_PROFILE_PAGE_ID}`, env),
    queryAll(env.NOTION_COURSES_DATABASE_ID, env, {
      filter: { property: '启用', checkbox: { equals: true } },
      sorts: [{ property: '排序', direction: 'ascending' }],
    }),
    queryAll(env.NOTION_CLASS_RECORDS_DATABASE_ID, env, {
      filter: { property: '上课时间', date: { on_or_after: start, before: end } },
      sorts: [{ property: '上课时间', direction: 'descending' }],
    }),
  ]);
  validatePageParent(profilePage, env.NOTION_CHILD_PROFILE_DATABASE_ID, 'Profile page');
  const courses = coursePages.map(mapCourse).filter((course) => course.name);
  const courseMap = new Map(courses.map((course) => [normalizeNotionId(course.id), course]));
  const records = recordPages.map((page) => mapClassRecord(page, courseMap));
  return Response.json({
    profile: mapChildProfile(profilePage),
    courses,
    records,
    summary: summarizeClasses(records, courses, year),
    year,
  }, { headers: NO_STORE_HEADERS });
}

async function createClassRecord(request, env) {
  requireClassesConfig(env);
  const body = await readClassRecordRequest(request);
  const pinError = await validateActionPin(request, env, body.pin, 'class-record');
  if (pinError) return pinError;
  const validation = validateClassRecord(body);
  if (validation) return validation;

  const coursePage = await notion(`/pages/${body.courseId}`, env);
  validatePageParent(coursePage, env.NOTION_COURSES_DATABASE_ID, 'Course page');
  if (coursePage.archived || coursePage.in_trash || !coursePage.properties?.['启用']?.checkbox) {
    return json({ error: '课程已经停用', code: 'COURSE_DISABLED' }, 400);
  }
  const course = mapCourse(coursePage);
  const properties = {
    '记录': titleProperty(`${course.name} - ${body.start.slice(0, 10)}`),
    '课程': { relation: [{ id: coursePage.id }] },
    '上课时间': { date: { start: body.start, ...(body.end ? { end: body.end } : {}) } },
    '状态': { status: { name: body.status } },
    '时长': body.duration ? { number: body.duration } : { number: null },
    '上课内容': richTextProperty(body.content),
    '课堂表现': body.performance ? { select: { name: body.performance } } : { select: null },
    '老师点评': richTextProperty(body.comment),
    '地点': richTextProperty(body.location),
  };
  const page = await notion('/pages', env, {
    method: 'POST',
    body: JSON.stringify({ parent: { database_id: env.NOTION_CLASS_RECORDS_DATABASE_ID }, properties }),
  });
  return Response.json({
    record: mapClassRecord(page, new Map([[normalizeNotionId(course.id), course]])),
  }, { status: 201, headers: NO_STORE_HEADERS });
}

async function startClassUpload(request, env) {
  requireClassesConfig(env);
  const body = await readJson(request);
  if (!isNotionId(body.recordId)) return json({ error: '上课记录无效', code: 'INVALID_RECORD' }, 400);
  if (!isClassMediaType(body.contentType) || !body.filename || String(body.filename).length > 255) {
    return json({ error: '只支持图片或视频文件', code: 'INVALID_FILE' }, 400);
  }
  if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.numberOfParts !== Math.ceil(body.size / (10 * 1024 * 1024))) {
    return json({ error: '文件信息无效', code: 'INVALID_FILE' }, 400);
  }
  const page = await notion(`/pages/${body.recordId}`, env);
  validatePageParent(page, env.NOTION_CLASS_RECORDS_DATABASE_ID, 'Class record');
  if (page.archived || page.in_trash) return json({ error: '记录不存在', code: 'NOT_FOUND' }, 404);
  if ((page.properties?.['媒体']?.files || []).length >= 5) return json({ error: '一条记录最多保存 5 个文件', code: 'TOO_MANY_FILES' }, 400);
  const upload = await notion('/file_uploads', env, {
    method: 'POST', headers: { 'Notion-Version': '2025-09-03' },
    body: JSON.stringify({ mode: 'multi_part', number_of_parts: body.numberOfParts, filename: body.filename, content_type: body.contentType }),
  });
  const session = { uploadId: upload.id, recordId: page.id, filename: body.filename, contentType: body.contentType, size: body.size, parts: body.numberOfParts, exp: Math.floor(Date.now() / 1000) + 60 * 60 };
  return json({ uploadId: upload.id, token: await createUploadToken(session, env.AUTH_SECRET) }, 201);
}

async function sendClassUploadPart(request, env, uploadId, partNumber) {
  const session = await verifyUploadToken(request.headers.get('X-Upload-Token'), env.AUTH_SECRET);
  if (!session || normalizeNotionId(session.uploadId) !== normalizeNotionId(uploadId) || partNumber < 1 || partNumber > session.parts) {
    return json({ error: '上传会话无效或已过期', code: 'INVALID_UPLOAD_SESSION' }, 403);
  }
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > 20 * 1024 * 1024) return json({ error: '上传分片过大', code: 'CHUNK_TOO_LARGE' }, 413);
  const chunk = await request.arrayBuffer();
  if (!chunk.byteLength || chunk.byteLength > 20 * 1024 * 1024) return json({ error: '上传分片无效', code: 'INVALID_CHUNK' }, 400);
  const expectedSize = partNumber < session.parts ? 10 * 1024 * 1024 : session.size - (session.parts - 1) * 10 * 1024 * 1024;
  if (chunk.byteLength !== expectedSize) return json({ error: '上传分片大小不正确', code: 'INVALID_CHUNK_SIZE' }, 400);
  const form = new FormData();
  form.append('file', new Blob([chunk], { type: session.contentType }), session.filename);
  form.append('part_number', String(partNumber));
  await notion(`/file_uploads/${uploadId}/send`, env, { method: 'POST', headers: { 'Notion-Version': '2025-09-03' }, body: form });
  return json({ partNumber });
}

async function completeClassUpload(request, env, uploadId) {
  const body = await readJson(request);
  const session = await verifyUploadToken(body.token, env.AUTH_SECRET);
  if (!session || normalizeNotionId(session.uploadId) !== normalizeNotionId(uploadId)) {
    return json({ error: '上传会话无效或已过期', code: 'INVALID_UPLOAD_SESSION' }, 403);
  }
  const page = await notion(`/pages/${session.recordId}`, env);
  validatePageParent(page, env.NOTION_CLASS_RECORDS_DATABASE_ID, 'Class record');
  if (page.archived || page.in_trash) return json({ error: '记录不存在', code: 'NOT_FOUND' }, 404);
  const files = page.properties?.['媒体']?.files || [];
  if (files.some((file) => normalizeNotionId(file.file_upload?.id) === normalizeNotionId(uploadId))) return json({ attached: true });
  if (files.length >= 5) return json({ error: '一条记录最多保存 5 个文件', code: 'TOO_MANY_FILES' }, 400);
  const upload = await notion(`/file_uploads/${uploadId}`, env, { headers: { 'Notion-Version': '2025-09-03' } });
  if (upload.status !== 'uploaded') {
    await notion(`/file_uploads/${uploadId}/complete`, env, { method: 'POST', headers: { 'Notion-Version': '2025-09-03' }, body: JSON.stringify({}) });
  }
  const uploaded = { name: session.filename, type: 'file_upload', file_upload: { id: uploadId } };
  await notion(`/pages/${page.id}`, env, { method: 'PATCH', body: JSON.stringify({ properties: { '媒体': { files: [...files, uploaded] } } }) });
  return json({ attached: true });
}

async function proxyProfileAvatar(request, env) {
  requireClassesConfig(env);
  const page = await notion(`/pages/${env.NOTION_CHILD_PROFILE_PAGE_ID}`, env);
  validatePageParent(page, env.NOTION_CHILD_PROFILE_DATABASE_ID, 'Profile page');
  const file = page.properties?.['头像']?.files?.[0];
  if (!file) return json({ error: '还没有上传头像', code: 'AVATAR_NOT_FOUND' }, 404);
  return proxyNotionFile(request, file);
}

async function proxyCourseIcon(request, env, courseId) {
  requireClassesConfig(env);
  const page = await notion(`/pages/${courseId}`, env);
  validatePageParent(page, env.NOTION_COURSES_DATABASE_ID, 'Course page');
  if (page.icon?.type !== 'file') return json({ error: '课程图片图标不存在', code: 'ICON_NOT_FOUND' }, 404);
  return proxyNotionFile(request, { name: 'course-icon', type: 'file', file: page.icon.file });
}

async function proxyClassMedia(request, env, recordId, index) {
  requireClassesConfig(env);
  const page = await notion(`/pages/${recordId}`, env);
  validatePageParent(page, env.NOTION_CLASS_RECORDS_DATABASE_ID, 'Class record');
  if (page.archived || page.in_trash) return json({ error: '记录不存在', code: 'NOT_FOUND' }, 404);
  const file = page.properties?.['媒体']?.files?.[index];
  if (!file) return json({ error: '媒体不存在', code: 'MEDIA_NOT_FOUND' }, 404);
  return proxyNotionFile(request, file);
}

async function proxyNotionFile(request, file) {
  const sourceUrl = file.type === 'file' ? file.file?.url : '';
  if (!sourceUrl) return json({ error: '媒体不可用', code: 'MEDIA_UNAVAILABLE' }, 404);
  const headers = new Headers();
  const range = request.headers.get('Range');
  if (range) headers.set('Range', range);
  const response = await fetch(sourceUrl, { headers });
  if (!response.ok && response.status !== 206) return json({ error: '媒体读取失败', code: 'MEDIA_FETCH_FAILED' }, 502);
  const responseHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    'Content-Type': response.headers.get('Content-Type') || mediaContentType(file.name),
    'Accept-Ranges': response.headers.get('Accept-Ranges') || 'bytes',
  });
  for (const name of ['Content-Length', 'Content-Range']) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: responseHeaders });
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

function mapChildProfile(page) {
  const properties = page.properties || {};
  return {
    name: plainText(properties['姓名']?.title) || '多乐',
    birthday: properties['生日']?.date?.start || '2022-01-29',
    avatarUrl: properties['头像']?.files?.length ? '/api/class-avatar' : '',
  };
}

function mapCourse(page) {
  const properties = page.properties || {};
  return {
    id: page.id,
    name: plainText(properties['课程']?.title),
    color: properties['颜色']?.select?.name || '粉色',
    teacher: plainText(properties['老师']?.rich_text),
    location: plainText(properties['地点']?.rich_text),
    defaultDuration: properties['默认时长']?.number || 0,
    order: properties['排序']?.number || 0,
    icon: page.icon?.type === 'emoji'
      ? { type: 'emoji', value: page.icon.emoji }
      : page.icon?.type === 'file' ? { type: 'image', value: `/api/class-course-icon/${page.id}` } : null,
  };
}

function mapClassRecord(page, courseMap) {
  const properties = page.properties || {};
  const courseId = properties['课程']?.relation?.[0]?.id || '';
  const course = courseMap.get(normalizeNotionId(courseId)) || null;
  const mediaFiles = properties['媒体']?.files || [];
  return {
    id: page.id,
    courseId,
    course,
    start: properties['上课时间']?.date?.start || page.created_time,
    end: properties['上课时间']?.date?.end || '',
    status: properties['状态']?.status?.name || '计划中',
    duration: properties['时长']?.number || 0,
    content: plainText(properties['上课内容']?.rich_text),
    performance: properties['课堂表现']?.select?.name || '',
    comment: plainText(properties['老师点评']?.rich_text),
    location: plainText(properties['地点']?.rich_text) || course?.location || '',
    media: mediaFiles.map((file, index) => ({
      name: file.name || `课堂媒体 ${index + 1}`,
      type: isVideoFile(file.name) ? 'video' : 'image',
      url: `/api/class-media/${page.id}/${index}`,
    })),
  };
}

function summarizeClasses(records, courses, year) {
  const validRecords = records.filter((record) => record.status === '已完成' || record.status === '试听');
  const activeDays = new Set(validRecords.map((record) => shanghaiDateKey(new Date(record.start))));
  const courseCounts = new Map();
  const monthCounts = new Map();
  for (const record of validRecords) {
    courseCounts.set(record.courseId, (courseCounts.get(record.courseId) || 0) + 1);
    const month = Number(shanghaiDateKey(new Date(record.start)).slice(5, 7));
    monthCounts.set(month, (monthCounts.get(month) || 0) + 1);
  }
  const favoriteCourse = [...courses].sort((left, right) =>
    (courseCounts.get(right.id) || 0) - (courseCounts.get(left.id) || 0) || left.order - right.order)[0];
  const busiestMonth = [...monthCounts].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] || 0;
  return {
    completedCount: validRecords.length,
    activeDays: activeDays.size,
    favoriteCourseId: validRecords.length ? favoriteCourse?.id || '' : '',
    currentWeekStreak: currentClassWeekStreak(activeDays, year),
    busiestMonth,
  };
}

function currentClassWeekStreak(activeDays, year) {
  const nowParts = shanghaiDateParts();
  if (Number(nowParts.year) !== year) return 0;
  const today = new Date(`${nowParts.year}-${nowParts.month}-${nowParts.day}T12:00:00+08:00`);
  const weekday = (today.getUTCDay() + 6) % 7;
  let weekStart = new Date(today.getTime() - weekday * 86400000);
  let streak = 0;
  while (true) {
    let hasClass = false;
    for (let offset = 0; offset < 7; offset += 1) {
      if (activeDays.has(shanghaiDateKey(new Date(weekStart.getTime() + offset * 86400000)))) {
        hasClass = true;
        break;
      }
    }
    if (!hasClass) return streak;
    streak += 1;
    weekStart = new Date(weekStart.getTime() - 7 * 86400000);
  }
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

async function readClassRecordRequest(request) {
  if (!request.headers.get('Content-Type')?.includes('multipart/form-data')) return { ...(await readJson(request)), files: [] };
  const form = await request.formData();
  return {
    pin: form.get('pin'),
    courseId: String(form.get('courseId') || ''),
    start: String(form.get('start') || ''),
    end: String(form.get('end') || ''),
    status: String(form.get('status') || ''),
    duration: Number(form.get('duration') || 0),
    content: String(form.get('content') || '').trim(),
    performance: String(form.get('performance') || ''),
    comment: String(form.get('comment') || '').trim(),
    location: String(form.get('location') || '').trim(),
    files: form.getAll('media').filter((value) => value instanceof File && value.size > 0),
  };
}

function validateClassRecord(body) {
  const statuses = new Set(['计划中', '已完成', '请假', '取消', '试听']);
  const performances = new Set(['', '很开心', '认真', '有进步', '需要鼓励']);
  if (!isNotionId(body.courseId)) return json({ error: '请选择课程', code: 'INVALID_COURSE' }, 400);
  if (!Number.isFinite(Date.parse(body.start))) return json({ error: '请选择正确的上课时间', code: 'INVALID_DATE' }, 400);
  if (body.end && (!Number.isFinite(Date.parse(body.end)) || Date.parse(body.end) <= Date.parse(body.start))) {
    return json({ error: '结束时间必须晚于开始时间', code: 'INVALID_END_DATE' }, 400);
  }
  if (!statuses.has(body.status)) return json({ error: '课程状态无效', code: 'INVALID_STATUS' }, 400);
  if (!performances.has(body.performance)) return json({ error: '课堂表现无效', code: 'INVALID_PERFORMANCE' }, 400);
  if (!Number.isInteger(body.duration) || body.duration < 0 || body.duration > 480) {
    return json({ error: '时长需要在 0 到 480 分钟之间', code: 'INVALID_DURATION' }, 400);
  }
  if (body.content.length > 2000 || body.comment.length > 2000 || body.location.length > 200) {
    return json({ error: '填写内容过长', code: 'CONTENT_TOO_LONG' }, 400);
  }
  if (body.files.length > 5) return json({ error: '一次最多上传 5 个文件', code: 'TOO_MANY_FILES' }, 400);
  for (const file of body.files) {
    if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
      return json({ error: '只支持图片或视频文件', code: 'INVALID_FILE_TYPE' }, 400);
    }
  }
  return null;
}

function isClassMediaType(value) {
  return typeof value === 'string' && (value.startsWith('image/') || value.startsWith('video/'));
}

async function createUploadToken(payload, secret) {
  const encoded = base64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${encoded}.${await sign(encoded, secret)}`;
}

async function verifyUploadToken(token, secret) {
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ''));
  if (!match || !timingSafeEqual(await sign(match[1], secret), match[2])) return null;
  try {
    const padded = match[1].replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - match[1].length % 4) % 4);
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))));
    return payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}

async function validateActionPin(request, env, pin, namespace) {
  const key = `${namespace}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`;
  if (isLoginBlocked(key)) return json({ error: '尝试次数太多，请 15 分钟后再试', code: 'RATE_LIMITED' }, 429);
  if (!await pinMatches(pin, env)) {
    recordLoginFailure(key);
    return json({ error: '家长 PIN 不正确', code: 'PIN_INVALID' }, 401);
  }
  failedLogins.delete(key);
  return null;
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

function requireClassesConfig(env) {
  if (!env.NOTION_TOKEN || !env.NOTION_CHILD_PROFILE_DATABASE_ID || !env.NOTION_CHILD_PROFILE_PAGE_ID ||
      !env.NOTION_COURSES_DATABASE_ID || !env.NOTION_CLASS_RECORDS_DATABASE_ID) {
    throw new Error('Classes databases are not configured');
  }
}

function validatePageParent(page, databaseId, label) {
  if (page.parent?.database_id?.replaceAll('-', '') !== databaseId.replaceAll('-', '')) {
    throw new Error(`${label} is invalid`);
  }
}

function normalizeNotionId(value) {
  return String(value || '').replaceAll('-', '');
}

function shanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function shanghaiDateKey(date = new Date()) {
  const values = shanghaiDateParts(date);
  return `${values.year}-${values.month}-${values.day}`;
}

function shanghaiYearRange(year) {
  return {
    start: `${year}-01-01T00:00:00+08:00`,
    end: `${year + 1}-01-01T00:00:00+08:00`,
  };
}

function isVideoFile(name = '') {
  return /\.(mp4|mov|m4v|webm|ogg)(?:$|\?)/i.test(name);
}

function mediaContentType(name = '') {
  if (/\.mp4$/i.test(name)) return 'video/mp4';
  if (/\.mov$/i.test(name)) return 'video/quicktime';
  if (/\.webm$/i.test(name)) return 'video/webm';
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.gif$/i.test(name)) return 'image/gif';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
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
