# Discord Automation Workers

A Cloudflare-first suite of Discord automation workers built on **SQLite-backed Durable Objects**. The current suite includes reaction moderation, guild blocklist management, gateway/session automation, and timed roles, all deployed as a single Worker that keeps the Discord Gateway connection inside Cloudflare.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rogersau/discord-automation-workers)

> [!NOTE]
> The Deploy to Cloudflare button only works when the repository is public.

## Current workers and capabilities

- **Reaction moderation** that removes blocked emoji reactions from Discord messages
- **SQLite Durable Object moderation store** for shared config and timed-role state
- **Gateway session Durable Object** that connects to Discord from Cloudflare
- **Guild-scoped slash commands** for blocklist and timed-role management
- **Signed `/interactions` endpoint** for Discord interactions
- **Automatic slash command sync** before each bootstrap when `DISCORD_APPLICATION_ID` is set
- **Automatic gateway bootstrap** on a scheduled trigger after deploy
- **Operator/admin HTTP APIs** for global blocklist reads/writes and gateway status/start
- **No KV namespace setup** and no external reaction relay required

The required setup is adding your Discord token, configuring the public Discord application values, and registering the Worker URL as the Discord interactions endpoint.

## Architecture

- `ModerationStoreDO` stores blocked emojis and app config in SQLite.
- `GatewaySessionDO` maintains the Discord Gateway connection, resumes sessions, and applies moderation to `MESSAGE_REACTION_ADD` events.
- The public Worker exposes `/health`, `/interactions`, `/admin/gateway/status`, and `/admin/gateway/start`.
- Discord slash commands update the current server's blocklist.
- The `/admin/*` HTTP routes remain the operator surface for gateway control.

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Discord application with a bot token

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers).
2. Create an application and a bot user.
3. Copy the bot token for `DISCORD_BOT_TOKEN`.
4. Copy the bot user ID for `BOT_USER_ID`.
5. Copy the application ID for `DISCORD_APPLICATION_ID`.
6. Copy the public key for `DISCORD_PUBLIC_KEY`.
7. Invite the bot with at least the **Manage Messages** permission.

The gateway session requests the `GUILDS` and `GUILD_MESSAGE_REACTIONS` intents. No privileged intents are required for the current moderation flow. To use the slash commands, the person invoking them must have **Administrator** or **Manage Guild** in that server.

### 3. Configure Wrangler variables and secrets

Set the non-secret Discord values in `wrangler.toml`:

```toml
[vars]
BOT_USER_ID = "123456789012345678"
DISCORD_PUBLIC_KEY = "your-discord-public-key"
DISCORD_APPLICATION_ID = "123456789012345678"
```

Then add the runtime secrets:

```bash
wrangler secret put DISCORD_BOT_TOKEN

# Optional: require bearer auth for admin routes.
wrangler secret put ADMIN_AUTH_SECRET
```

### 4. Deploy the suite

```bash
pnpm run deploy
```

Deploy provisions:

- `ModerationStoreDO`
- `GatewaySessionDO`
- SQLite migrations for both Durable Objects
- a five-minute cron trigger that bootstraps the gateway session automatically

### 5. Configure the Discord interactions endpoint

In the Discord Developer Portal, open your application and set **Interactions Endpoint URL** to:

```text
https://your-worker-url.workers.dev/interactions
```

Discord will validate the endpoint using `DISCORD_PUBLIC_KEY`. This is a one-time setup per deployed URL. If you change your Worker URL, update the endpoint in Discord.

### 6. Verify gateway startup and command sync

After `DISCORD_BOT_TOKEN` is present, the scheduled bootstrap will start the gateway session automatically within five minutes. If `DISCORD_APPLICATION_ID` is also configured, the Worker first syncs `SLASH_COMMAND_DEFINITIONS` to Discord with the application commands REST API and then starts the gateway session.

To check status:

```bash
curl https://your-worker-url.workers.dev/admin/gateway/status
```

To force an immediate start instead of waiting for the next scheduled bootstrap:

```bash
curl -X POST https://your-worker-url.workers.dev/admin/gateway/start
```

That admin bootstrap path uses the same command-sync-first flow as the scheduled bootstrap, so it is the fastest way to force a command re-sync after updating configuration.

If `ADMIN_AUTH_SECRET` is configured, include it as a bearer token on admin requests:

```bash
curl https://your-worker-url.workers.dev/admin/gateway/status \
  -H "Authorization: Bearer $ADMIN_AUTH_SECRET"
```

If command sync fails, the Worker logs the sync error but still attempts to start the gateway session.

## Current slash commands

Once the interactions endpoint is configured and a bootstrap has run successfully, Discord will expose:

- `/blocklist add emoji:<emoji>` — block an emoji in the current server
- `/blocklist remove emoji:<emoji>` — unblock an emoji in the current server
- `/blocklist list` — show the current server's blocked emojis
- `/timedrole add user:<member> role:<role> duration:<duration>` — assign a pre-configured role temporarily
- `/timedrole remove user:<member> role:<role>` — remove an active timed role early
- `/timedrole list` — list active timed roles in the current server

Examples:

```text
/blocklist add emoji:✅
/blocklist remove emoji:✅
/timedrole add user:@member role:@Muted duration:1w
/timedrole remove user:@member role:@Muted
/timedrole list
```

Only members with **Administrator** or **Manage Guild** permissions can use the commands.

These commands are **server-local**: they update the blocklist or timed-role assignments for the guild where they are used. If an emoji is already blocked or already absent, the bot returns an explicit no-op message instead of pretending a change happened.

`/blocklist list` responds ephemerally to the invoker and shows the blocked emojis for the current server.

For timed roles, the role must already exist and be configured in Discord; the bot only adds and removes it on a timer.

## Admin API

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Basic health check |
| POST | `/interactions` | Discord interactions callback endpoint |
| GET | `/admin/gateway/status` | Return current gateway session state |
| POST | `/admin/gateway/start` | Force an immediate command sync + gateway bootstrap |

If `ADMIN_AUTH_SECRET` is configured, all `/admin/*` routes require `Authorization: Bearer <secret>`.

## Local validation

```bash
pnpm test
pnpm run typecheck
pnpm exec wrangler deploy --dry-run
```

## Project structure

```text
├── src/
│   ├── durable-objects/
│   │   ├── gateway-session.ts
│   │   └── moderation-store.ts
│   ├── blocklist.ts
│   ├── discord-commands.ts
│   ├── discord-interactions.ts
│   ├── discord.ts
│   ├── env.ts
│   ├── gateway.ts
│   ├── index.ts
│   ├── reaction-moderation.ts
│   ├── timed-roles.ts
│   └── types.ts
├── test/
├── wrangler.toml
├── package.json
└── README.md
```

## License

MIT
