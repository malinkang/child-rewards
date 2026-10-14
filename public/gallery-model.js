// Framework-free, side-effect-free helpers for the artwork wall page.
// Mirrors the Worker route so nothing else can reach an <img> or <audio> src.
const MEDIA_PATH_PATTERN = /^\/api\/artwork-media\/[0-9a-f-]{32,36}\/(image|audio)$/i;

export const UNKNOWN_ARTWORK_LABEL = '未命名作品';

// Only same-origin Worker media paths may reach an <img> or an <audio> src.
export function isSafeMediaPath(value) {
  return typeof value === 'string' && MEDIA_PATH_PATTERN.test(value);
}

export function mapArtworks(payload) {
  const list = Array.isArray(payload?.artworks) ? payload.artworks : [];
  const artworks = [];
  for (const item of list) {
    if (!item || typeof item.id !== 'string' || !isSafeMediaPath(item.image)) continue;
    artworks.push({
      id: item.id,
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : null,
      title: typeof item.title === 'string' ? item.title : '',
      description: typeof item.description === 'string' ? item.description : '',
      date: typeof item.date === 'string' ? item.date : '',
      image: item.image,
      audio: isSafeMediaPath(item.audio) ? item.audio : '',
    });
  }
  return artworks;
}

export function artworkLabel(artwork) {
  const description = `${artwork?.description || ''}`.trim();
  if (description) return description;
  const title = `${artwork?.title || ''}`.trim();
  return title || UNKNOWN_ARTWORK_LABEL;
}

export function formatArtworkDate(value) {
  if (typeof value !== 'string' || !value) return '';
  const time = Date.parse(value);
  if (Number.isNaN(time)) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(time);
}

export function stepIndex(current, delta, total) {
  const size = Number.isInteger(total) ? total : 0;
  if (size <= 0) return -1;
  if (!Number.isInteger(current) || current < 0 || current >= size) {
    return delta < 0 ? size - 1 : 0;
  }
  return ((current + delta) % size + size) % size;
}
