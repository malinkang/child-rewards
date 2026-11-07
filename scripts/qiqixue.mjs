import { createHash } from 'node:crypto';

const SOURCE_URL = 'https://m.qiqixue.com/qqx/parentCenter/growth/summaryList';
const PAGE_SIZE = 10;
const BEIJING_OFFSET = 8 * 60 * 60 * 1000;

// Never print upstream messages, bodies, identifiers, or caught exception text.
const SAFE_CODES = new Set([
  'MISSING_QIQIXUE_COOKIE', 'MISSING_QIQIXUE_SYNC_TOKEN', 'INVALID_ARGUMENTS',
  'SOURCE_AUTH_EXPIRED', 'SOURCE_REJECTED', 'SOURCE_SCHEMA_INVALID',
  'SOURCE_SCHEMA_ENVELOPE_INVALID', 'SOURCE_SCHEMA_RET_CODE_INVALID',
  'SOURCE_SCHEMA_DATA_INVALID', 'SOURCE_SCHEMA_DAY_INVALID',
  'SOURCE_SCHEMA_CARD_INVALID', 'SOURCE_SCHEMA_CARD_ID_INVALID',
  'SOURCE_SCHEMA_CARD_CONTENT_TYPE_INVALID', 'SOURCE_SCHEMA_CARD_CONTENT_JSON_INVALID',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_CONTAINER_INVALID',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_MISSING',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_TITLE',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_NAME',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_BOOK',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_BOOK_TITLE',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_LOWERCASE',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_TYPE_INVALID',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_EMPTY',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_TOO_LONG',
  'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_CONTROL_CHARACTER',
  'SOURCE_SCHEMA_CARD_PEN_INVALID',
  'SOURCE_DATE_INVALID', 'SOURCE_STUDY_TYPE_UNSUPPORTED', 'SOURCE_RECORD_CONFLICT',
  'SOURCE_PAGINATION_INCOMPLETE', 'SOURCE_PAGINATION_REPEATED', 'SOURCE_TOTAL_CHANGED',
  'SOURCE_REQUEST_FAILED', 'SOURCE_TIMEOUT', 'SOURCE_HTTP_ERROR', 'SOURCE_INVALID_JSON',
  'DESTINATION_REQUEST_FAILED', 'DESTINATION_TIMEOUT', 'DESTINATION_HTTP_ERROR',
  'DESTINATION_INVALID_JSON', 'DESTINATION_RESPONSE_INVALID', 'SUMMARY_WRITE_FAILED',
  'SYNC_FAILED',
]);

export class QiqixueError extends Error {
  constructor(code) {
    const safeCode = SAFE_CODES.has(code) ? code : 'SYNC_FAILED';
    super(safeCode);
    this.code = safeCode;
  }
}

export function safeErrorCode(error) {
  return error instanceof QiqixueError && SAFE_CODES.has(error.code) ? error.code : 'SYNC_FAILED';
}

function requireValue(condition, code = 'SOURCE_SCHEMA_INVALID') {
  if (!condition) throw new QiqixueError(code);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDate(value) {
  requireValue(typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value), 'SOURCE_DATE_INVALID');
  const instant = new Date(`${value}T00:00:00.000Z`);
  requireValue(Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value,
    'SOURCE_DATE_INVALID');
}

function beijingTime(value) {
  requireValue(typeof value === 'string' && /^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value),
    'SOURCE_DATE_INVALID');
  const iso = `${value.replace(' ', 'T')}+08:00`;
  const instant = Date.parse(iso);
  requireValue(Number.isFinite(instant)
    && new Date(instant + BEIJING_OFFSET).toISOString().slice(0, 19).replace('T', ' ') === value,
  'SOURCE_DATE_INVALID');
  return { iso, instant };
}

function sourceIdPart(value) {
  requireValue((Number.isSafeInteger(value) && value > 0)
    || (typeof value === 'string' && /^[1-9]\d{0,19}$/.test(value)));
  return String(value);
}

export function normalizeCard(card, day) {
  requireValue(isObject(card) && isObject(day), 'SOURCE_SCHEMA_CARD_INVALID');
  validateDate(day.date);
  validateDate(card.learnDate);
  requireValue(card.learnDate === day.date, 'SOURCE_DATE_INVALID');
  requireValue(card.studyType === 1, 'SOURCE_STUDY_TYPE_UNSUPPORTED');
  requireValue(typeof day.isWifiPen === 'boolean'
    && (card.isWifiPen === null || typeof card.isWifiPen === 'boolean'),
  'SOURCE_SCHEMA_CARD_PEN_INVALID');
  requireValue(typeof card.content === 'string', 'SOURCE_SCHEMA_CARD_CONTENT_TYPE_INVALID');
  let content;
  try {
    content = JSON.parse(card.content);
  } catch {
    throw new QiqixueError('SOURCE_SCHEMA_CARD_CONTENT_JSON_INVALID');
  }
  requireValue(isObject(content), 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_CONTAINER_INVALID');
  const bookField = Object.hasOwn(content, 'book_name')
    ? 'book_name' : Object.hasOwn(content, 'bookName') ? 'bookName' : null;
  if (bookField === null) {
    const alternateField = [
      ['title', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_TITLE'],
      ['name', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_NAME'],
      ['book', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_BOOK'],
      ['bookTitle', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_BOOK_TITLE'],
      ['bookname', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_UNDER_LOWERCASE'],
    ].find(([field]) => Object.hasOwn(content, field));
    if (alternateField) throw new QiqixueError(alternateField[1]);
    if (process.env.QIQIXUE_SCHEMA_DIAGNOSTIC === '1') {
      const hashes = Object.keys(content).sort().map((field) =>
        createHash('sha256').update(field).digest('hex').slice(0, 16));
      process.stderr.write(`QIQIXUE_BOOK_SCHEMA_KEYS=${hashes.join(',')}\n`);
    }
    throw new QiqixueError('SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_MISSING');
  }
  const bookName = content[bookField];
  requireValue(typeof bookName === 'string', 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_TYPE_INVALID');
  requireValue(bookName.trim().length > 0, 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_EMPTY');
  requireValue(bookName.length <= 500, 'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_TOO_LONG');
  requireValue(
    !/[\u0000-\u001f\u007f]/.test(bookName),
    'SOURCE_SCHEMA_CARD_CONTENT_BOOK_NAME_CONTROL_CHARACTER',
  );
  const start = beijingTime(card.learnStart);
  const end = beijingTime(card.learnEnd);
  requireValue(card.learnStart.slice(0, 10) === day.date && end.instant >= start.instant, 'SOURCE_DATE_INVALID');
  return {
    sourceId: `qiqixue:${sourceIdPartOrCode(card.userId)}:${sourceIdPartOrCode(card.id)}`,
    book: bookName,
    start: start.iso,
    end: end.iso,
    seconds: (end.instant - start.instant) / 1000,
    wifiPen: card.isWifiPen ?? day.isWifiPen,
  };
}

function sourceIdPartOrCode(value) {
  try {
    return sourceIdPart(value);
  } catch {
    throw new QiqixueError('SOURCE_SCHEMA_CARD_ID_INVALID');
  }
}

export async function fetchJson(url, options, {
  fetchImpl = globalThis.fetch, timeoutMs = 20_000,
} = {}, kind = 'SOURCE') {
  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error', signal });
  } catch {
    throw new QiqixueError(`${kind}_${signal.aborted ? 'TIMEOUT' : 'REQUEST_FAILED'}`);
  }
  if (kind === 'SOURCE' && [401, 403].includes(response.status)) {
    throw new QiqixueError('SOURCE_AUTH_EXPIRED');
  }
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    throw new QiqixueError(`${kind}_${signal.aborted ? 'TIMEOUT' : response.ok ? 'INVALID_JSON' : 'HTTP_ERROR'}`);
  }
}

export async function fetchSourceRecords({ cookie, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  requireValue(typeof cookie === 'string' && cookie.trim().length > 0, 'MISSING_QIQIXUE_COOKIE');
  const days = new Set();
  const records = new Map();
  let total;
  for (let pageNum = 1; ; pageNum += 1) {
    const url = new URL(SOURCE_URL);
    url.search = new URLSearchParams({ pageNum, pageSize: PAGE_SIZE }).toString();
    const { status, body } = await fetchJson(url, {
      method: 'GET',
      headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Referer: 'https://m.qiqixue.com/' },
    }, { fetchImpl, timeoutMs });
    if (isObject(body) && [body.code, body.ret].some((code) => [401, 403, '401', '403'].includes(code))) {
      throw new QiqixueError('SOURCE_AUTH_EXPIRED');
    }
    requireValue(status === 200, 'SOURCE_HTTP_ERROR');
    requireValue(isObject(body), 'SOURCE_SCHEMA_ENVELOPE_INVALID');
    requireValue(typeof body.ret === 'number' && typeof body.code === 'number',
      'SOURCE_SCHEMA_RET_CODE_INVALID');
    requireValue(body.ret === 0 && body.code === 0, 'SOURCE_REJECTED');
    const data = body.data;
    requireValue(isObject(data) && Number.isSafeInteger(data.total) && data.total >= 0
      && data.pageNum === pageNum && data.pageSize === PAGE_SIZE
      && Array.isArray(data.dayList) && data.dayList.length <= PAGE_SIZE,
    'SOURCE_SCHEMA_DATA_INVALID');
    if (total === undefined) total = data.total;
    requireValue(data.total === total, 'SOURCE_TOTAL_CHANGED');
    requireValue(data.dayList.length > 0, 'SOURCE_PAGINATION_INCOMPLETE');
    for (const day of data.dayList) {
      requireValue(isObject(day), 'SOURCE_SCHEMA_DAY_INVALID');
      validateDate(day.date);
      requireValue(!days.has(day.date), 'SOURCE_PAGINATION_REPEATED');
      requireValue(typeof day.isWifiPen === 'boolean' && Array.isArray(day.cards) && day.cards.length > 0,
        'SOURCE_SCHEMA_DAY_INVALID');
      days.add(day.date);
      for (const card of day.cards) {
        const record = normalizeCard(card, day);
        const previous = records.get(record.sourceId);
        requireValue(!previous || JSON.stringify(previous) === JSON.stringify(record), 'SOURCE_RECORD_CONFLICT');
        records.set(record.sourceId, record);
      }
    }
    requireValue(days.size <= total, 'SOURCE_PAGINATION_INCOMPLETE');
    if (days.size === total) return { days: days.size, records: [...records.values()] };
  }
}
