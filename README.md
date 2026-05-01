# Discord Automation Workers

A Cloudflare-first suite of Discord automation workers built on **SQLite-backed Durable Objects**. The current suite includes reaction moderation, guild blocklist management, timed roles, ticket panels, transcript archiving, and an admin dashboard, all deployed as a single Worker that keeps the Discord Gateway connection inside Cloudflare.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rogersau/discord-automation-workers)

> [!NOTE]
> The Deploy to Cloudflare button only works when the repository is public.

New to Cloudflare? Start with [FirstTimeUser.md](./FirstTimeUser.md) for the beginner Deploy to Cloudflare button walkthrough before using the setup steps below.

## Current workers and capabilities

- **Reaction moderation** that removes blocked emoji reactions from Discord messages
- **SQLite Durable Object moderation store** for shared config and timed-role state
- **Gateway session Durable Object** that connects to Discord from Cloudflare
- **Guild-scoped slash commands** for blocklist and timed-role management
- **Ticket panels and private ticket channels** managed from the admin dashboard
- **Plain-text and HTML ticket transcripts** with transcript-channel summary embeds and archived inline image/video attachments
- **Signed `/interactions` endpoint** for Discord interactions
- **Automatic slash command sync** before each bootstrap when `DISCORD_APPLICATION_ID` is set
- **Automatic gateway bootstrap** on a scheduled trigger after deploy
- **Protected Admin UI** at `/admin/login` and `/admin` for gateway status/bootstrap, guild blocklist management, timed-role management, and ticket panel configuration by guild
- **No KV namespace setup** and no external reaction relay required

The required setup is adding your Discord token, configuring the public Discord application values, creating the transcript R2 bucket defined in `wrangler.toml`, and registering the Worker URL as the Discord interactions endpoint.

## Architecture

- `ModerationStoreDO` stores blocked emojis and app config in SQLite.
- `GatewaySessionDO` maintains the Discord Gateway connection, resumes sessions, and applies moderation to `MESSAGE_REACTION_ADD` events.
- The public Worker exposes `/health`, `/interactions`, `/transcripts/:guildId/:channelId`, `/admin/login`, and the protected `/admin` dashboard.
- Discord slash commands update the current server's blocklist and timed-role state.
- Ticket transcripts can be stored in R2 and served back as HTML transcript pages.

## Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [pnpm](https://pnpm.io/installation) or Node's bundled `corepack`
- A [Cloudflare account](https://dash.cloudflare.com/sign-up/workers-and-pages)
- A Discord application with a bot token

You do not need a global Wrangler install for this repo. The commands below use the local Wrangler dependency through `pnpm exec` or the package scripts.

## Setup

### 1. Install dependencies

```bash
corepack enable
pnpm install
```

### 2. Sign in to Cloudflare from your terminal

```bash
pnpm exec wrangler login
```

This opens Cloudflare in your browser so Wrangler can connect to your account.

### 3. Create a Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers).
2. Create an application and a bot user.
3. Copy the bot token for `DISCORD_BOT_TOKEN`.
4. Copy the bot user ID for `BOT_USER_ID`.
5. Copy the application ID for `DISCORD_APPLICATION_ID`.
6. Copy the public key for `DISCORD_PUBLIC_KEY`.
7. Invite the bot with the permissions required for the features you plan to use.

   For the full suite described in this README, grant:
   - **View Channels**
   - **Send Messages**
   - **Embed Links**
   - **Read Message History**
   - **Manage Messages**
   - **Manage Channels**
   - **Attach Files**
   - **Manage Roles**

   `Manage Messages` is used for reaction moderation. `Manage Roles` is used for timed roles. The ticket panel flow also needs the channel and message permissions above so the bot can publish the panel, create private ticket channels, post the opening message, read ticket history, and upload transcripts.

The gateway session requests the `GUILDS` and `GUILD_MESSAGE_REACTIONS` intents. No privileged intents are required for the current moderation flow. To use the slash commands, the person invoking them must have **Administrator** or **Manage Guild** in that server.

### 4. Create the transcript bucket in Cloudflare R2

This repo's default `wrangler.toml` binds the Worker to an R2 bucket named `discord-automation-workers-transcripts` so closed tickets can keep an HTML transcript page.

```bash
pnpm exec wrangler r2 bucket create discord-automation-workers-transcripts
```

If you want a different bucket name, change the `bucket_name` value under `[[r2_buckets]]` in `wrangler.toml` before you deploy.

### 5. Configure Wrangler variables and secrets

Set the non-secret Discord values in `wrangler.toml`:

```toml
[vars]
BOT_USER_ID = "123456789012345678"
DISCORD_PUBLIC_KEY = "your-discord-public-key"
DISCORD_APPLICATION_ID = "123456789012345678"
```

Then add the runtime secrets:

```bash
pnpm exec wrangler secret put DISCORD_BOT_TOKEN

# Required: enable the admin dashboard login at /admin/login.
pnpm exec wrangler secret put ADMIN_UI_PASSWORD

# Required: dedicated secret for signing admin session cookies.
pnpm exec wrangler secret put ADMIN_SESSION_SECRET

# Optional: legacy admin bearer-auth secret; not used for dashboard session cookies.
pnpm exec wrangler secret put ADMIN_AUTH_SECRET
```

### 6. Deploy the suite

```bash
pnpm run deploy
```

Deploy provisions:

- `ModerationStoreDO`
- `GatewaySessionDO`
- SQLite migrations for both Durable Objects
- a five-minute cron trigger that bootstraps the gateway session automatically
- the public Worker routes, including HTML transcript pages when the R2 bucket is configured

### 7. Configure the Discord interactions endpoint

In the Discord Developer Portal, open your application and set **Interactions Endpoint URL** to:

```text
https://your-worker-url.workers.dev/interactions
```

Discord will validate the endpoint using `DISCORD_PUBLIC_KEY`. This is a one-time setup per deployed URL. If you change your Worker URL, update the endpoint in Discord.

### 8. Verify gateway startup and command sync

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
   - configure ticket panels, categories, transcript channels, and ticket types by guild

The dashboard uses secure, signed session cookies (signed with `ADMIN_SESSION_SECRET`) and replaces ad-hoc `curl` commands as the supported operator surface for runtime administration.

If command sync fails, the Worker logs the sync error but still attempts to start the gateway session.

### 9. Set up ticket panels in the admin dashboard

Use the admin dashboard to configure **one ticket panel per guild**:

1. Choose the panel channel where the ticket buttons should be posted.
2. Pick the shared ticket category that new private ticket channels will be created under.
3. Choose the transcript channel that will receive closed-ticket uploads.
4. Add ticket types with a support role and up to five modal questions per type.
5. Publish the panel from the dashboard so Discord receives the current button layout.

When a member clicks a ticket button, the Worker opens the ticket modal. After the modal is submitted, it creates a private ticket channel in the shared category. When the ticket is closed, the Worker uploads a transcript to the configured transcript channel, stores the HTML transcript and attachment media in R2, exposes the transcript at `/transcripts/:guildId/:channelId`, and then deletes the ticket channel.

The bot needs these Discord permissions in the guild:

- View Channels
- Send Messages
- Embed Links
- Manage Channels
- Read Message History
- Attach Files

The broader worker suite also needs **Manage Messages** for reaction moderation and **Manage Roles** for timed roles.

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

| Method   | Endpoint                           | Description                                                                                            |
| -------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ |
| GET      | `/health`                          | Basic health check                                                                                     |
| POST     | `/interactions`                    | Discord interactions callback endpoint                                                                 |
| GET      | `/transcripts/:guildId/:channelId` | Public HTML transcript page for a closed ticket                                                        |
| GET      | `/admin/login`                     | Render the admin login page                                                                            |
| GET      | `/admin`                           | Render the authenticated admin dashboard                                                               |
| GET      | `/admin/api/gateway/status`        | Runtime endpoint used by the dashboard for gateway state                                               |
| POST     | `/admin/api/gateway/start`         | Runtime endpoint used by the dashboard to force bootstrap                                              |
| GET/POST | `/admin/api/*`                     | Session-protected dashboard APIs for gateway, guild blocklist, timed-role, and ticket-panel operations |

Set `ADMIN_UI_PASSWORD` and `ADMIN_SESSION_SECRET` to enable the supported browser-based operator workflow. The dashboard is the supported interface for gateway status/bootstrap, reviewing stored guild state, guild blocklist management, and timed-role management by guild ID. Admin session cookies are signed with `ADMIN_SESSION_SECRET` to ensure secure authentication.

## Hosting model

This project targets Cloudflare Workers and Durable Objects only. Standalone Node and Docker hosting are no longer supported deployment paths.

## Local validation

```bash
pnpm run lint
pnpm run format:check
pnpm test
pnpm run typecheck
pnpm exec wrangler deploy --dry-run
```

## Project structure

```text
├── src/
│   ├── admin/
│   ├── durable-objects/
│   │   ├── gateway-session.ts
│   │   └── moderation-store.ts
│   ├── routes/
│   ├── runtime/
│   ├── services/
│   ├── blocklist.ts
│   ├── discord-commands.ts
│   ├── discord-interactions.ts
│   ├── discord.ts
│   ├── env.ts
│   ├── gateway.ts
│   ├── index.ts
│   ├── reaction-moderation.ts
│   ├── tickets.ts
│   ├── timed-roles.ts
│   └── types.ts
├── test/
├── FirstTimeUser.md
├── wrangler.toml
├── package.json
└── README.md
```

## License

MIT
