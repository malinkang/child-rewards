const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=60, s-maxage=60',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/gifts') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: JSON_HEADERS });
      }
      return getGifts(env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function getGifts(env) {
  if (!env.NOTION_TOKEN || !env.NOTION_DATABASE_ID) {
    return Response.json({ error: 'Notion is not configured' }, { status: 500, headers: JSON_HEADERS });
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': env.NOTION_VERSION || '2022-06-28',
      },
      body: JSON.stringify({
        filter: { property: '启用', checkbox: { equals: true } },
        sorts: [
          { property: '排序', direction: 'ascending' },
          { timestamp: 'created_time', direction: 'ascending' },
        ],
        page_size: 100,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error('Notion query failed', response.status, error.code || 'unknown_error');
      return Response.json({ error: '礼品数据暂时无法读取' }, { status: 502, headers: JSON_HEADERS });
    }

    const data = await response.json();
    const gifts = data.results.map(mapGift).filter((gift) => gift.name && gift.cost > 0);
    return Response.json({ gifts, refreshedAt: new Date().toISOString() }, { headers: JSON_HEADERS });
  } catch (error) {
    console.error('Notion request failed', error instanceof Error ? error.message : 'unknown_error');
    return Response.json({ error: '礼品数据暂时无法读取' }, { status: 502, headers: JSON_HEADERS });
  }
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

function plainText(items = []) {
  return items.map((item) => item.plain_text || '').join('').trim();
}
