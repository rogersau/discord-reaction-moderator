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
- **Protected Admin UI** at `/admin/login` and `/admin` for gateway status/bootstrap, guild blocklist management, and timed-role management by guild ID
- **No KV namespace setup** and no external reaction relay required

The required setup is adding your Discord token, configuring the public Discord application values, and registering the Worker URL as the Discord interactions endpoint.

## Architecture

- `ModerationStoreDO` stores blocked emojis and app config in SQLite.
- `GatewaySessionDO` maintains the Discord Gateway connection, resumes sessions, and applies moderation to `MESSAGE_REACTION_ADD` events.
- The public Worker exposes `/health`, `/interactions`, `/admin/login`, and the protected `/admin` dashboard.
- Discord slash commands update the current server's blocklist.
- The shared runtime serves the same admin routes in Cloudflare and the portable Node/Docker deployment.

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
7. Invite the bot with at least the **Manage Messages** and **Manage Roles** permissions.

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

# Required: enable the admin dashboard login at /admin/login.
wrangler secret put ADMIN_UI_PASSWORD

# Optional: require bearer auth for legacy admin routes.
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

Open the admin dashboard:

1. Visit `https://your-worker-url.workers.dev/admin/login`
2. Sign in with the password you stored in `ADMIN_UI_PASSWORD`
3. Use the dashboard to:
   - inspect the live gateway snapshot
   - trigger an immediate bootstrap/command sync
   - review stored guild blocklists and timed roles discovered from slash-command state
   - manage a guild blocklist by guild ID
   - list/add/remove timed roles by guild ID

The dashboard replaces ad-hoc `curl` commands as the supported operator surface for runtime administration.

If `ADMIN_AUTH_SECRET` is configured for legacy automation, include it as a bearer token on the underlying admin routes:

```bash
curl https://your-worker-url.workers.dev/admin/gateway/status \
  -H "Authorization: Bearer $ADMIN_AUTH_SECRET"
```

If command sync fails, the Worker logs the sync error but still attempts to start the gateway session.

### 7. Set up ticket panels in the admin dashboard

Use the admin dashboard to configure **one ticket panel per guild**:

1. Choose the panel channel where the ticket buttons should be posted.
2. Pick the shared ticket category that new private ticket channels will be created under.
3. Choose the transcript channel that will receive closed-ticket uploads.
4. Add ticket types with a support role and up to five modal questions per type.
5. Publish the panel from the dashboard so Discord receives the current button layout.

When a member clicks a ticket button, the Worker opens the ticket modal. After the modal is submitted, it creates a private ticket channel in the shared category. When the ticket is closed, the Worker uploads a transcript to the configured transcript channel and then deletes the ticket channel.

The bot needs these Discord permissions in the guild:

- View Channels
- Send Messages
- Manage Channels
- Read Message History
- Attach Files

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

For timed roles, the role must already exist and be configured in Discord; the bot only adds and removes it on a timer. The bot also needs **Manage Roles**, and its highest role must be above the role it is trying to assign or remove.

## Admin UI and operator routes

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/health` | Basic health check |
| POST | `/interactions` | Discord interactions callback endpoint |
| GET | `/admin/login` | Render the admin login page |
| GET | `/admin` | Render the authenticated admin dashboard |
| GET | `/admin/gateway/status` | Legacy runtime endpoint used by the dashboard for gateway state |
| POST | `/admin/gateway/start` | Legacy runtime endpoint used by the dashboard to force bootstrap |
| GET/POST | `/admin/api/*` | Session-protected dashboard APIs for gateway, guild blocklist, and timed-role operations |

Set `ADMIN_UI_PASSWORD` to enable the supported browser-based operator workflow. The dashboard is the supported interface for gateway status/bootstrap, reviewing stored guild state, guild blocklist management, and timed-role management by guild ID. If `ADMIN_AUTH_SECRET` is configured, bearer auth still applies to the legacy `/admin/gateway/*` routes.

## Run outside Cloudflare with Docker

1. Build the image:

   ```bash
   pnpm run docker:build
   ```

2. Start the self-contained runtime:

   ```bash
    docker run --rm -p 8787:8787 \
      -e DISCORD_BOT_TOKEN=... \
      -e BOT_USER_ID=... \
      -e DISCORD_PUBLIC_KEY=... \
      -e DISCORD_APPLICATION_ID=... \
      -e ADMIN_UI_PASSWORD=... \
      -e SQLITE_PATH=/data/runtime.sqlite \
      -v "$PWD/data:/data" \
      discord-automation-workers
    ```

This container hosts the HTTP API, Discord gateway connection, scheduler, and SQLite database in one process. Windows packaging can build on the same portable runtime later, but it is not part of this phase.

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
