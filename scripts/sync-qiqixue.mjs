import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fetchJson, fetchSourceRecords, QiqixueError, safeErrorCode } from './qiqixue.mjs';

const DESTINATION_URL = 'https://child.malinkang.com/api/sync/qiqixue';
// Only these documented machine codes may cross the destination log boundary.
const DESTINATION_CODES = new Set([
  'SYNC_UNAUTHORIZED', 'SYNC_NOT_CONFIGURED', 'SYNC_UNAVAILABLE', 'SYNC_RECONCILIATION_REQUIRED',
  'INVALID_BODY', 'INVALID_RECORD', 'SOURCE_CONFLICT', 'NOTION_UNAVAILABLE',
  'NOTION_READ_FAILED', 'NOTION_INVALID_RESPONSE', 'NOTION_CREATE_FAILED',
  'TASK_READ_FAILED', 'TASK_INVALID', 'MANUAL_RECORD_REVIEW_REQUIRED',
]);

class DestinationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function errorCode(error) {
  return error instanceof DestinationError && DESTINATION_CODES.has(error.code)
    ? error.code : safeErrorCode(error);
}

export async function syncQiqixue({
  cookie, token, dryRun = true, fetchImpl = globalThis.fetch, sleep = delay, timeoutMs = 60_000,
} = {}) {
  if (typeof cookie !== 'string' || !cookie.trim()) throw new QiqixueError('MISSING_QIQIXUE_COOKIE');
  if (typeof token !== 'string' || !token.trim()) throw new QiqixueError('MISSING_QIQIXUE_SYNC_TOKEN');
  if (typeof dryRun !== 'boolean') throw new QiqixueError('INVALID_ARGUMENTS');
  let requested = false;
  const pacedFetch = async (url, options) => {
    if (requested) await sleep(750);
    requested = true;
    return fetchImpl(url, options);
  };
  // Complete source validation is a barrier: no destination request happens before it.
  const { days, records } = await fetchSourceRecords({ cookie, fetchImpl: pacedFetch, timeoutMs });
  const counts = { days, records: records.length, created: 0, exists: 0, would_create: 0 };
  for (const record of records) {
    const { status, body } = await fetchJson(DESTINATION_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ record, dryRun }),
    }, { fetchImpl: pacedFetch, timeoutMs }, 'DESTINATION');
    if (body && DESTINATION_CODES.has(body.code)) throw new DestinationError(body.code);
    if (status !== 200 && status !== 201) throw new QiqixueError('DESTINATION_HTTP_ERROR');
    const allowedStatuses = dryRun ? ['exists', 'would_create'] : ['created', 'exists'];
    if (!body || body.code !== undefined || !allowedStatuses.includes(body.status)) {
      throw new QiqixueError('DESTINATION_RESPONSE_INVALID');
    }
    counts[body.status] += 1;
  }
  return counts;
}

function parseDryRun(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--dry-run', '--dry-run=true'].includes(argv[0]))) return true;
  if (argv.length === 1 && argv[0] === '--dry-run=false') return false;
  throw new QiqixueError('INVALID_ARGUMENTS');
}

export async function main({
  argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, sleep = delay,
  stdout = console.log, stderr = console.error, appendSummary = appendFile,
} = {}) {
  try {
    const counts = await syncQiqixue({
      cookie: env.QIQIXUE_COOKIE, token: env.QIQIXUE_SYNC_TOKEN,
      dryRun: parseDryRun(argv), fetchImpl, sleep,
    });
    const summary = Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(' ');
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        await appendSummary(env.GITHUB_STEP_SUMMARY, `${summary}\n`, 'utf8');
      } catch {
        throw new QiqixueError('SUMMARY_WRITE_FAILED');
      }
    }
    stdout(summary);
    return 0;
  } catch (error) {
    stderr(errorCode(error));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
