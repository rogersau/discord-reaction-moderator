# Discord Reaction Moderator

A Cloudflare Worker that applies emoji reaction moderation logic for forwarded Discord reaction events.

## Features

- Blocks specified emoji reactions globally or per-guild
- Easy emoji list management via admin API (no redeploys needed)
- Discord request verification for signed HTTP requests (Ed25519)
- Free tier friendly (Cloudflare Workers generous free plan)

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Discord application with a bot ([Discord Developer Portal](https://discord.com/developers))

## Setup

### 1. Create a Discord Application and Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers)
2. Create a new Application
3. Go to **Bot** and create a bot token
4. Enable these **Privileged Gateway Intents**:
   - **Message Content Intent** (required for reading message content)
   - **Server Member Intent** (for guild-specific settings)
5. Copy the bot token (you'll need it for `DISCORD_BOT_TOKEN`)

### 2. Create the KV Namespace

```bash
cd discord-reaction-moderator
npm install
wrangler kv:namespace create BLOCKLIST_KV
```

Copy the `id` output and paste it into `wrangler.toml` under `[[kv_namespaces]]`.

For preview/development:
```bash
wrangler kv:namespace create --env preview BLOCKLIST_KV
```

### 3. Configure Secrets

```bash
# Bot token from Discord Developer Portal
wrangler secret put DISCORD_BOT_TOKEN

# Public key from Discord Developer Portal (General Information page)
wrangler secret put DISCORD_PUBLIC_KEY

# Optional: protect /admin/blocklist with a bearer token
wrangler secret put ADMIN_AUTH_SECRET
```

### 4. Set Your Bot User ID

In `wrangler.toml`, set `BOT_USER_ID` to your bot's user ID (found in Discord developer mode under the bot's profile).

### 5. Forward reaction events to the Worker

1. In Discord Developer Portal, go to your application
2. Go to **OAuth2** → **OAuth2 URL Generator**
3. Check the `bot` scope
4. For permissions, check:
   - `Manage Messages`
5. Use the generated URL to add the bot to your server
6. Run a Gateway-capable bot or relay that listens for `MESSAGE_REACTION_ADD` events and POSTs them to this Worker.

> Discord does **not** deliver `MESSAGE_REACTION_ADD` over standard webhooks or the Interactions Endpoint URL. Reaction events come from the Gateway API, so this repository needs a relay/bot process to forward those events into the Worker.

### 6. Deploy

```bash
npm run deploy
```

Copy the worker URL (e.g., `https://discord-reaction-moderator.your-subdomain.workers.dev`).

### 7. Point your relay at the Worker

Configure your Gateway relay to POST events to:
```
https://your-worker-url.discord-reaction-moderator.workers.dev
```

## Managing the Blocklist

### View current blocklist

```bash
curl https://your-worker-url.workers.dev/admin/blocklist
```

If you configured `ADMIN_AUTH_SECRET`, include it as a bearer token:

```bash
curl https://your-worker-url.workers.dev/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_AUTH_SECRET"
```

### Add an emoji to block

```bash
curl -X POST https://your-worker-url.workers.dev/admin/blocklist \
  -H "Content-Type: application/json" \
  -d '{"emoji": "🏳️‍🌈", "action": "add"}'
```

If you prefer managing the deployed blocklist directly in Cloudflare KV with Wrangler, update the `blocklist_config` key:

```bash
npx wrangler kv:key get blocklist_config --binding=BLOCKLIST_KV --text
```

Save the updated config to a file such as `blocklist_config.json`, then write it back to KV:

```json
{
  "emojis": ["🏳️‍🌈", "🏳️‍⚧️", "🏳️", "🟤", "🏴", "🏴‍☠️", "☣️", "🔞", "🍎", "✅"],
  "guilds": {},
  "botUserId": ""
}
```

```bash
npx wrangler kv:key put blocklist_config \
  --binding=BLOCKLIST_KV \
  --path ./blocklist_config.json
```

If you use the admin API after setting `ADMIN_AUTH_SECRET`, send the same bearer token in the `Authorization` header:

```bash
curl -X POST https://your-worker-url.workers.dev/admin/blocklist \
  -H "Authorization: Bearer $ADMIN_AUTH_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"emoji": "✅", "action": "add"}'
```

### Remove an emoji from block

```bash
curl -X POST https://your-worker-url.workers.dev/admin/blocklist \
  -H "Content-Type: application/json" \
  -d '{"emoji": "🏳️‍🌈", "action": "remove"}'
```

### Default Blocked Emojis

These emojis are blocked by default:
- 🏳️‍🌈 Rainbow flag
- 🏳️‍⚧️ Trans flag
- 🏳️ White flag
- 🏴 Black flag
- 🏴‍☠️ Pirate flag
- ☣️ Biohazard
- 🔞 NSFW

## Admin API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/admin/blocklist` | View current blocklist config |
| POST | `/admin/blocklist` | Add/remove emojis |

If `ADMIN_AUTH_SECRET` is configured with `wrangler secret put ADMIN_AUTH_SECRET`, the admin endpoint requires `Authorization: Bearer <secret>`. If the secret is not configured, the admin endpoint remains open.

## Security Notes

1. **Admin endpoint** — Set `ADMIN_AUTH_SECRET` to require a bearer token on `/admin/blocklist`.
2. **Discord signature verification** — Always verifies incoming requests against Discord's public key.
3. **Bot self-ignore** — The bot ignores its own reactions (configured via `BOT_USER_ID`).

## Project Structure

```
├── src/
│   ├── index.ts      # Main worker entry point
│   ├── types.ts      # TypeScript type definitions
│   ├── discord.ts    # Discord API helpers
│   └── blocklist.ts  # Blocklist management via KV
├── wrangler.toml     # Cloudflare Workers config
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT
