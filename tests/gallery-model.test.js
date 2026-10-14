import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNKNOWN_ARTWORK_LABEL,
  artworkLabel,
  formatArtworkDate,
  isSafeMediaPath,
  mapArtworks,
  stepIndex,
} from '../public/gallery-model.js';

const ID_A = '3f986019c92c81b7818ae6d6d4b0c127';
const ID_B = 'b'.repeat(32);

test('isSafeMediaPath only accepts the exact same-origin media route shape', () => {
  assert.equal(isSafeMediaPath(`/api/artwork-media/${ID_A}/image`), true);
  assert.equal(isSafeMediaPath(`/api/artwork-media/${ID_A}/audio`), true);
  assert.equal(isSafeMediaPath(`/api/artwork-media/${ID_A}/video`), false);
  assert.equal(isSafeMediaPath('/api/artwork-media/short/image'), false);
  assert.equal(isSafeMediaPath('/api/artwork-media/../../etc/passwd'), false);
  assert.equal(isSafeMediaPath('https://cdn.example.test/art.png'), false);
  assert.equal(isSafeMediaPath('//cdn.example.test/art.png'), false);
  assert.equal(isSafeMediaPath('/api/poetry'), false);
  assert.equal(isSafeMediaPath(''), false);
  assert.equal(isSafeMediaPath(null), false);
  assert.equal(isSafeMediaPath(undefined), false);
});

test('mapArtworks normalizes rows and drops unusable ones', () => {
  const artworks = mapArtworks({
    artworks: [
      null,
      { id: ID_A },
      {
        id: ID_B,
        order: 4,
        title: '多乐作品 04',
        description: '描述',
        date: '2026-10-14T08:18:00.000Z',
        image: `/api/artwork-media/${ID_B}/image`,
        audio: `https://cdn.example.test/${ID_B}.mp3`,
      },
      {
        id: 'c'.repeat(32),
        order: Number.NaN,
        title: 42,
        description: null,
        date: 20261014,
        image: `/api/artwork-media/${'c'.repeat(32)}/image`,
        audio: `/api/artwork-media/${'c'.repeat(32)}/audio`,
      },
    ],
  });
  assert.equal(artworks.length, 2);
  assert.deepEqual(artworks.map((artwork) => artwork.id), [ID_B, 'c'.repeat(32)]);
  const second = artworks[1];
  assert.deepEqual(
    [second.order, second.title, second.description, second.date, second.audio],
    [null, '', '', '', `/api/artwork-media/${'c'.repeat(32)}/audio`],
  );
  assert.deepEqual(mapArtworks(null), []);
  assert.deepEqual(mapArtworks({ artworks: 'nope' }), []);
  assert.deepEqual(mapArtworks({}), []);
});

test('artworkLabel falls back from description to title to the unknown label', () => {
  assert.equal(artworkLabel({ description: ' 海草和海浪 ', title: '多乐作品 01' }), '海草和海浪');
  assert.equal(artworkLabel({ description: '   ', title: '多乐作品 01' }), '多乐作品 01');
  assert.equal(artworkLabel({ description: '', title: '' }), UNKNOWN_ARTWORK_LABEL);
  assert.equal(artworkLabel({}), UNKNOWN_ARTWORK_LABEL);
  assert.equal(artworkLabel(null), UNKNOWN_ARTWORK_LABEL);
});

test('formatArtworkDate renders Asia/Shanghai dates across the UTC boundary', () => {
  assert.equal(formatArtworkDate('2026-10-13T15:30:00.000Z'), '2026年10月13日');
  assert.equal(formatArtworkDate('2026-10-13T16:00:00.000Z'), '2026年10月14日');
  assert.equal(formatArtworkDate('2026-10-14'), '2026年10月14日');
  assert.equal(formatArtworkDate(''), '');
  assert.equal(formatArtworkDate('not-a-date'), '');
  assert.equal(formatArtworkDate(null), '');
  assert.equal(formatArtworkDate(undefined), '');
});

test('stepIndex wraps in both directions and survives empty walls', () => {
  assert.equal(stepIndex(0, 1, 3), 1);
  assert.equal(stepIndex(2, 1, 3), 0);
  assert.equal(stepIndex(0, -1, 3), 2);
  assert.equal(stepIndex(1, -1, 3), 0);
  assert.equal(stepIndex(0, 1, 1), 0);
  assert.equal(stepIndex(0, -1, 1), 0);
  assert.equal(stepIndex(-1, 1, 3), 0);
  assert.equal(stepIndex(-1, -1, 3), 2);
  assert.equal(stepIndex(9, 1, 3), 0);
  assert.equal(stepIndex(0, 1, 0), -1);
  assert.equal(stepIndex(0, -1, -2), -1);
  assert.equal(stepIndex(0, 1, Number.NaN), -1);
});
