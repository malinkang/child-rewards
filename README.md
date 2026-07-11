# Child Rewards

A Cloudflare Worker app for tracking a child's star rewards with tasks, history, and gifts managed in Notion.

## Data

- Tasks and their page icons are read from the Notion `每日任务` database.
- Star balances, completed tasks, and redemption history are stored in the Notion `星星记录` database.
- Gifts are read from the Notion `甜心礼品屋` database.
- Images and videos are uploaded and managed in the Notion `媒体` files property.
- The Notion token is stored as the Cloudflare secret `NOTION_TOKEN`.

## Development

```bash
npm install
npx wrangler secret put NOTION_TOKEN --local
npm run dev
```

The Worker configuration lives in `wrangler.toml`. The frontend is in `public/`, and the Worker API is in `src/index.js`.
