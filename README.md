# Child Rewards

A Cloudflare Worker app for tracking a child's local star rewards and displaying gifts managed in Notion.

## Data

- Star balances, completed tasks, and redemption history stay in browser `localStorage`.
- Gifts are read from a Notion database through the Worker API.
- Images and videos are uploaded and managed in the Notion `媒体` files property.
- The Notion token is stored as the Cloudflare secret `NOTION_TOKEN`.

## Development

```bash
npm install
npx wrangler secret put NOTION_TOKEN --local
npm run dev
```

The Worker configuration lives in `wrangler.toml`. The frontend is in `public/`, and the Worker API is in `src/index.js`.
