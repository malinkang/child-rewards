const DAY_MS = 86400000;
const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function beijingDateKey(value = new Date()) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? beijingFormatter.format(date) : '';
}

export function buildRewardsHeatmap(entries, year) {
  const earnedDays = new Map();
  for (const entry of entries) {
    if (entry.type !== 'earn' || !Number.isFinite(entry.stars) || entry.stars <= 0 || !entry.date) continue;
    const key = beijingDateKey(entry.date);
    if (!key) continue;
    if (!earnedDays.has(key)) earnedDays.set(key, { stars: 0, reasons: [] });
    const day = earnedDays.get(key);
    day.stars += entry.stars;
    if (typeof entry.reason === 'string' && entry.reason.trim()) day.reasons.push(entry.reason.trim());
  }

  // Use UTC for calendar arithmetic so the browser's timezone and DST cannot shift cells.
  const first = Date.UTC(year, 0, 1);
  const dayCount = (Date.UTC(year + 1, 0, 1) - first) / DAY_MS;
  const offset = (new Date(first).getUTCDay() + 6) % 7;
  const months = [];
  let totalStars = 0;
  let activeDays = 0;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(first + index * DAY_MS);
    const key = date.toISOString().slice(0, 10);
    const earned = earnedDays.get(key) || { stars: 0, reasons: [] };
    const column = Math.floor((offset + index) / 7) + 2;
    if (date.getUTCDate() === 1) months.push({ month: date.getUTCMonth() + 1, column });
    totalStars += earned.stars;
    if (earned.stars > 0) activeDays += 1;
    return { date: key, column, row: (offset + index) % 7 + 2, ...earned };
  });

  return {
    days, months, totalStars, activeDays,
    weekCount: Math.ceil((offset + dayCount) / 7),
    years: [...new Set([...earnedDays.keys()].map((key) => Number(key.slice(0, 4))))],
  };
}
