// Pure helpers for the poetry library: filtering, search, option ordering and
// safe text/URL rendering. Kept framework-free and side-effect free so node:test
// can exercise the same logic the page uses.

export const UNKNOWN_LABEL = '未标注';

const STAGE_SEQUENCE = ['小学', '初中', '高中'];
// Textbook order used by the Notion source (上册 before 下册, then 高中必修...).
export const GRADE_SEQUENCE = [
  '一年级上册', '一年级下册',
  '二年级上册', '二年级下册',
  '三年级上册', '三年级下册',
  '四年级上册', '四年级下册',
  '五年级上册', '五年级下册',
  '六年级上册', '六年级下册',
  '七年级上册', '七年级下册',
  '八年级上册', '八年级下册',
  '九年级上册', '九年级下册',
  '高中必修上册', '高中必修下册',
  '高中选择性必修上册', '高中选择性必修中册', '高中选择性必修下册',
  '高中选修',
];

export function labelOf(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : UNKNOWN_LABEL;
}

function sequenceRank(label, sequence) {
  if (label === UNKNOWN_LABEL) return sequence.length + 1;
  const index = sequence.indexOf(label);
  return index === -1 ? sequence.length : index;
}

function compareLabels(left, right, sequence) {
  const rank = sequenceRank(left, sequence) - sequenceRank(right, sequence);
  return rank || left.localeCompare(right, 'zh-Hans-CN');
}

function collectLabels(poems, read) {
  const labels = new Set();
  for (const poem of poems) labels.add(labelOf(read(poem)));
  return [...labels];
}

export function buildStageOptions(poems = []) {
  return collectLabels(poems, (poem) => poem.stage).sort((left, right) => compareLabels(left, right, STAGE_SEQUENCE));
}

export function buildGradeOptions(poems = [], stage = '') {
  const scoped = stage ? poems.filter((poem) => labelOf(poem.stage) === stage) : poems;
  return collectLabels(scoped, (poem) => poem.grade).sort((left, right) => compareLabels(left, right, GRADE_SEQUENCE));
}

export function buildStatusOptions(poems = []) {
  const labels = collectLabels(poems, (poem) => poem.status);
  return labels.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

// Grade filters must stay compatible with the chosen stage: when the current
// grade is not offered for the new stage, the selection resets.
export function normalizeGradeSelection(poems = [], stage = '', grade = '') {
  if (!grade) return '';
  return buildGradeOptions(poems, stage).includes(grade) ? grade : '';
}

function searchHaystack(poem) {
  return [poem.title, ...(poem.authors || []), poem.dynasty, poem.body]
    .map((value) => String(value ?? ''))
    .join('\n')
    .toLowerCase();
}

export function filterPoems(poems = [], { stage = '', grade = '', status = '', query = '' } = {}) {
  const term = String(query ?? '').trim().toLowerCase();
  return poems.filter((poem) => {
    if (stage && labelOf(poem.stage) !== stage) return false;
    if (grade && labelOf(poem.grade) !== grade) return false;
    if (status && labelOf(poem.status) !== status) return false;
    if (!term) return true;
    return searchHaystack(poem).includes(term);
  });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// Only HTTP(S) links are allowed through to href/src attributes.
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : '';
}
