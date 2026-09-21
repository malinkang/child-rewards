import test from 'node:test';
import assert from 'node:assert/strict';
import { beijingDateKey, buildRewardsHeatmap } from '../public/rewards-heatmap.js';

test('groups only positive earnings and preserves every same-day note', () => {
  const entry = { type: 'earn', stars: 1, date: '2026-09-12', reason: '学习汉字：穿' };
  const data = buildRewardsHeatmap([
    entry, { ...entry, reason: '学习汉字：身' }, entry,
    { ...entry, type: 'spend', stars: -2, reason: '兑换' },
    { ...entry, type: 'spend', stars: 2 },
    { ...entry, stars: 0 }, { ...entry, stars: -1 }, { ...entry, stars: NaN },
    { ...entry, date: 'invalid' }, { ...entry, date: null }, { ...entry, date: undefined },
    { ...entry, date: '2026-09-13', stars: 5, reason: '  ', title: '不回退到标题' },
    { ...entry, date: '2025-09-12' },
  ], 2026);
  const day = data.days.find((day) => day.date === '2026-09-12');
  assert.equal(day.stars, 3);
  assert.deepEqual(day.reasons, ['学习汉字：穿', '学习汉字：身', '学习汉字：穿']);
  assert.deepEqual(data.days.find((day) => day.date === '2026-09-13').reasons, []);
  assert.equal(data.totalStars, 8);
  assert.equal(data.activeDays, 2);
  assert.deepEqual(data.years.sort(), [2025, 2026]);
});

test('uses Beijing dates for timestamps and preserves date-only backfills', () => {
  assert.equal(beijingDateKey('2026-09-12'), '2026-09-12');
  assert.equal(beijingDateKey('2026-09-11T16:00:00Z'), '2026-09-12');
  assert.equal(beijingDateKey('2026-09-11T15:59:59Z'), '2026-09-11');
  assert.equal(beijingDateKey('2026-12-31T16:00:00Z'), '2027-01-01');
  assert.equal(beijingDateKey('2026-02-30'), '');
  assert.equal(beijingDateKey('invalid'), '');
  const data = buildRewardsHeatmap([
    { type: 'earn', stars: 2, date: '2026-12-31T16:00:00Z', reason: '跨年' },
    { type: 'earn', stars: 1, date: '2027-01-01', reason: '补录' },
  ], 2027);
  assert.equal(data.days[0].stars, 3);
  assert.deepEqual(data.days[0].reasons, ['跨年', '补录']);
});

test('lays out complete Monday-first years, leap days and 54-column years', () => {
  const normal = buildRewardsHeatmap([], 2026);
  assert.equal(normal.days.length, 365);
  assert.deepEqual(normal.days[0], { date: '2026-01-01', column: 2, row: 5, stars: 0, reasons: [] });
  assert.equal(normal.months.length, 12);
  const leap = buildRewardsHeatmap([], 2024);
  assert.equal(leap.days.length, 366);
  assert.ok(leap.days.some((day) => day.date === '2024-02-29'));
  const longYear = buildRewardsHeatmap([], 2012);
  assert.equal(longYear.weekCount, 54);
  assert.equal(longYear.days.at(-1).date, '2012-12-31');
  assert.equal(longYear.days.at(-1).column, 55);
  assert.equal(longYear.days.at(-1).row, 2);
  assert.equal(new Set(longYear.days.map((day) => `${day.column}:${day.row}`)).size, 366);
});
