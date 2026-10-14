import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_LABEL,
  GRADE_SEQUENCE,
  buildGradeOptions,
  buildStageOptions,
  buildStatusOptions,
  escapeHtml,
  filterPoems,
  labelOf,
  normalizeGradeSelection,
  safeHttpUrl,
} from '../public/poetry-library.js';

const poems = [
  { id: '1', title: '静夜思', authors: ['李白'], dynasty: '唐', body: '床前明月光', stage: '小学', grade: '一年级上册', status: '已掌握' },
  { id: '2', title: '望岳', authors: ['杜甫'], dynasty: '唐', body: '岱宗夫如何', stage: '初中', grade: '七年级上册', status: '复习中' },
  { id: '3', title: '赤壁赋', authors: ['苏轼'], dynasty: '宋', body: '壬戌之秋', stage: '高中', grade: '高中必修上册', status: '已掌握' },
  { id: '4', title: '村居', authors: [], dynasty: '', body: '草长莺飞二月天', stage: '小学', grade: '五年级下册', status: '复习中' },
  { id: '5', title: '无题', authors: [], dynasty: '', body: '', stage: '', grade: '', status: '' },
];

test('combines stage, grade, status and free-text search filters', () => {
  assert.deepEqual(filterPoems(poems).map((poem) => poem.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(filterPoems(poems, { stage: '小学' }).map((poem) => poem.id), ['1', '4']);
  assert.deepEqual(filterPoems(poems, { stage: '小学', grade: '一年级上册' }).map((poem) => poem.id), ['1']);
  assert.deepEqual(filterPoems(poems, { stage: '小学', grade: '五年级下册', status: '复习中' }).map((poem) => poem.id), ['4']);
  assert.deepEqual(filterPoems(poems, { status: '已掌握' }).map((poem) => poem.id), ['1', '3']);
  assert.deepEqual(filterPoems(poems, { stage: UNKNOWN_LABEL }).map((poem) => poem.id), ['5']);
  assert.deepEqual(filterPoems(poems, { grade: UNKNOWN_LABEL }).map((poem) => poem.id), ['5']);
  assert.deepEqual(filterPoems(poems, { status: UNKNOWN_LABEL }).map((poem) => poem.id), ['5']);
});

test('searches titles, authors, dynasties and bodies case-insensitively', () => {
  assert.deepEqual(filterPoems(poems, { query: '明月' }).map((poem) => poem.id), ['1']);
  assert.deepEqual(filterPoems(poems, { query: '李白' }).map((poem) => poem.id), ['1']);
  assert.deepEqual(filterPoems(poems, { query: '唐' }).map((poem) => poem.id), ['1', '2']);
  assert.deepEqual(filterPoems(poems, { query: '宋' }).map((poem) => poem.id), ['3']);
  assert.deepEqual(filterPoems(poems, { query: '草长' }).map((poem) => poem.id), ['4']);
  assert.deepEqual(filterPoems(poems, { query: '   ' }).map((poem) => poem.id), ['1', '2', '3', '4', '5']);
  assert.deepEqual(filterPoems(poems, { query: '不存在的诗' }), []);
  const english = [{ id: 'e', title: 'ABC Song', authors: ['Mozart'], dynasty: '', body: 'Def' }];
  assert.deepEqual(filterPoems(english, { query: 'abc' }).map((poem) => poem.id), ['e']);
  assert.deepEqual(filterPoems(english, { query: 'MOZART' }).map((poem) => poem.id), ['e']);
});

test('orders stages and grades by textbook sequence and keeps grades stage-compatible', () => {
  const mixed = [
    { stage: '高中', grade: '高中必修上册' },
    { stage: '小学', grade: '三年级下册' },
    { stage: '', grade: '七年级上册' },
    { stage: '初中', grade: '七年级上册' },
    { stage: '小学', grade: '一年级上册' },
    { stage: '', grade: '' },
    { stage: '高中', grade: '高中选修' },
    { stage: '高中', grade: '高中选择性必修下册' },
  ];
  assert.deepEqual(buildStageOptions(mixed), ['小学', '初中', '高中', UNKNOWN_LABEL]);
  assert.deepEqual(buildGradeOptions(mixed), ['一年级上册', '三年级下册', '七年级上册', '高中必修上册', '高中选择性必修下册', '高中选修', UNKNOWN_LABEL]);
  assert.deepEqual(buildGradeOptions(mixed, '小学'), ['一年级上册', '三年级下册']);
  assert.deepEqual(buildGradeOptions(mixed, '高中'), ['高中必修上册', '高中选择性必修下册', '高中选修']);
  assert.deepEqual(buildGradeOptions(mixed, '初中'), ['七年级上册']);
  assert.deepEqual(buildGradeOptions([], '小学'), []);
});

test('resets a grade selection that is incompatible with the newly selected stage', () => {
  assert.equal(normalizeGradeSelection(poems, '小学', '一年级上册'), '一年级上册');
  assert.equal(normalizeGradeSelection(poems, '高中', '一年级上册'), '');
  assert.equal(normalizeGradeSelection(poems, '', '七年级上册'), '七年级上册');
  assert.equal(normalizeGradeSelection(poems, '小学', ''), '');
  assert.equal(normalizeGradeSelection(poems, '小学', UNKNOWN_LABEL), '');
  const withUntaggedGrade = [...poems, { id: '6', title: '杂诗', stage: '小学', grade: '' }];
  assert.equal(normalizeGradeSelection(withUntaggedGrade, '小学', UNKNOWN_LABEL), UNKNOWN_LABEL);
  assert.equal(normalizeGradeSelection([], '小学', '一年级上册'), '');
});

test('sorts every textbook grade label in the real Notion order', () => {
  assert.equal(GRADE_SEQUENCE.length, 24);
  assert.equal(GRADE_SEQUENCE[0], '一年级上册');
  assert.equal(GRADE_SEQUENCE[23], '高中选修');
  const shuffled = [...GRADE_SEQUENCE].reverse().map((grade, index) => ({ stage: '', grade, id: String(index) }));
  assert.deepEqual(buildGradeOptions(shuffled), GRADE_SEQUENCE);
  const stages = [
    ...GRADE_SEQUENCE.slice(0, 12).map((grade) => ({ stage: '小学', grade })),
    ...GRADE_SEQUENCE.slice(12, 18).map((grade) => ({ stage: '初中', grade })),
    ...GRADE_SEQUENCE.slice(18).map((grade) => ({ stage: '高中', grade })),
  ];
  assert.deepEqual(buildGradeOptions(stages, '小学'), GRADE_SEQUENCE.slice(0, 12));
  assert.deepEqual(buildGradeOptions(stages, '初中'), GRADE_SEQUENCE.slice(12, 18));
  assert.deepEqual(buildGradeOptions(stages, '高中'), GRADE_SEQUENCE.slice(18));
});

test('orders statuses deterministically and maps blank values to an explicit label', () => {
  const statuses = buildStatusOptions(poems);
  assert.equal(statuses.length, 3);
  assert.deepEqual([...statuses].sort(), ['复习中', '已掌握', UNKNOWN_LABEL].sort());
  assert.equal(statuses.includes(UNKNOWN_LABEL), true);
  assert.equal(labelOf('  '), UNKNOWN_LABEL);
  assert.equal(labelOf(undefined), UNKNOWN_LABEL);
  assert.equal(labelOf('复习中'), '复习中');
});

test('escapes rendered text and only allows HTTP(S) links and audio', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  assert.equal(escapeHtml("O'Brien & Sons"), 'O&#039;Brien &amp; Sons');
  assert.equal(escapeHtml(null), '');
  assert.equal(safeHttpUrl('https://example.test/a.mp3'), 'https://example.test/a.mp3');
  assert.equal(safeHttpUrl('  http://example.test/a.mp3  '), 'http://example.test/a.mp3');
  assert.equal(safeHttpUrl('javascript:alert(1)'), '');
  assert.equal(safeHttpUrl('data:audio/mp3;base64,AAAA'), '');
  assert.equal(safeHttpUrl('/api/class-media/1/0'), '');
  assert.equal(safeHttpUrl(''), '');
  assert.equal(safeHttpUrl(null), '');
  const poemsWithUnsafeMedia = [
    { id: 'safe', title: 'A', link: 'https://example.test/poem', audio: [{ url: 'https://example.test/a.mp3' }] },
    { id: 'unsafe', title: 'B', link: 'javascript:alert(1)', audio: [{ url: 'javascript:alert(2)' }, { url: null }] },
  ];
  const filtered = filterPoems(poemsWithUnsafeMedia).map((poem) => ({
    link: safeHttpUrl(poem.link),
    audio: (poem.audio || []).map((clip) => safeHttpUrl(clip?.url)).filter(Boolean),
  }));
  assert.deepEqual(filtered, [
    { link: 'https://example.test/poem', audio: ['https://example.test/a.mp3'] },
    { link: '', audio: [] },
  ]);
});
