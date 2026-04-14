# Discord Slash Command Admin Design

## Problem

This project already moderates reactions through a Cloudflare Worker, a SQLite-backed `ModerationStoreDO`, and a `GatewaySessionDO`, but blocklist changes still require calling the HTTP admin API directly. The goal is to let Discord server administrators manage blocked emojis from inside Discord by using bot slash commands, while keeping the existing Cloudflare-first deployment model intact.

## Scope

This design adds a Discord interactions surface for **guild-scoped** emoji management:

1. `/blocklist add <emoji>`
2. `/blocklist remove <emoji>`

Only members with **Administrator** or **Manage Guild** permissions may use these commands. The commands modify only the invoking guild's blocked emoji list.

Out of scope:

- Prefix text commands
- DM command usage
- A new global-in-Discord moderation command surface
- Multi-bot or multi-application coordination

## Chosen Approach

Use a new public `/interactions` Worker route for Discord slash commands, backed by the existing `ModerationStoreDO` with new guild-scoped mutation endpoints.

This is preferred over gateway-only command parsing because:

- Discord slash commands are the standard UX for server admin actions
- Interaction handling fits Cloudflare Workers cleanly as signed HTTP requests
- The gateway session can stay focused on moderation instead of command parsing
- Guild-scoped writes map directly onto the existing SQLite schema

## Architecture

### Worker

The Worker gains three command-related responsibilities:

1. Verify Discord interaction signatures on `/interactions`
2. Handle slash command payloads and return interaction responses
3. Sync the slash command schema with Discord when the application boots

The interaction handler should be structured as a small command-routing layer rather than a single large conditional. Command definitions and command executors should be separated so future commands can be added by registering a new definition and handler pair instead of rewriting the whole endpoint.

The Worker remains the public entry point for:

- `/health`
- `/admin/blocklist`
- `/admin/gateway/status`
- `/admin/gateway/start`
- `/interactions`

The Worker continues to use Durable Object stubs instead of writing SQLite directly.

### ModerationStoreDO

`ModerationStoreDO` remains the source of truth for moderation data, but it needs guild-scoped write operations in addition to the current global emoji mutation flow.

New responsibilities:

- Add a blocked emoji to a single guild
- Remove a blocked emoji from a single guild
- Ensure a guild settings row exists when guild-specific configuration is written
- Return the updated effective config after guild mutations

The existing schema already supports this through:

- `guild_settings`
- `guild_blocked_emojis`

No new table is required for the first version.

### GatewaySessionDO

`GatewaySessionDO` does not parse or execute slash commands. It keeps its current role:

- Maintain the Discord Gateway connection
- Resume and recover sessions
- Moderate `MESSAGE_REACTION_ADD` events using the effective config

The slash command feature should not change the gateway session lifecycle.

## Command Design

### Command Shape

Register one slash command with subcommands:

1. `/blocklist add emoji:<string>`
2. `/blocklist remove emoji:<string>`

The `emoji` option accepts either:

- a unicode emoji like `✅`
- a custom emoji token such as `:party_blob:` or `party_blob:1234567890`

The same normalization rules already used by moderation should be reused so command writes and moderation reads stay consistent.

The command definition should be represented in a reusable structure that can later hold additional slash commands. Discord command sync should be driven from that structure so the first feature does not hard-code `blocklist` into the sync path.

### Authorization

Commands are allowed only when all of the following are true:

1. The interaction comes from a guild
2. The invoking member has either the `Administrator` permission or the `Manage Guild` permission
3. The command payload is valid

Unauthorized users receive an **ephemeral** denial message. The command should not fall back to role-name matching.

### Responses

All command responses should be ephemeral and short:

- success add: `Added ✅ to this server's blocked emoji list.`
- success remove: `Removed ✅ from this server's blocked emoji list.`
- duplicate add: `✅ is already blocked in this server.`
- missing remove: `✅ is not currently blocked in this server.`
- invalid emoji: `Provide a valid unicode or custom emoji.`
- unauthorized: `You need Administrator or Manage Guild to use this command.`

## Runtime Flow

### Slash Command Handling

1. Discord sends an interaction to `/interactions`.
2. The Worker verifies the request signature using Discord's Ed25519 public key.
3. `PING` requests return the required Discord pong response.
4. Application command requests are parsed and validated.
5. The Worker checks guild context and member permissions.
6. The emoji input is normalized using the shared normalization logic.
7. The Worker forwards the guild mutation to `ModerationStoreDO`.
8. The Worker returns an ephemeral success or error message.

### Command Registration

Command registration should be automatic when the bot boots successfully and the required configuration is present.

Required runtime configuration:

- `DISCORD_BOT_TOKEN`
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`

Registration behavior:

1. The Worker syncs the slash command definition to Discord through the application commands REST API.
2. Sync runs during the existing bootstrap path used after deploy.
3. Sync is idempotent so repeated scheduled bootstraps do not create duplicate commands.
4. If command sync fails, the failure is logged explicitly but does not stop gateway startup.

This keeps the deploy flow close to the existing model: one-time portal configuration plus env/secrets, then normal deploy/bootstrap behavior.

### Discord Portal Setup

One-time Discord-side setup is required:

1. Set the interaction endpoint URL to `https://<worker>/interactions`
2. Provide `DISCORD_APPLICATION_ID` to the Worker configuration

After that, the Worker owns command syncing.

## Data and Interface Changes

### Worker Surface

Add:

- `POST /interactions`

Keep existing admin routes unchanged. The slash command flow is a new Discord-native surface, not a replacement for the operator HTTP API.

Internally, the interactions route should dispatch through a command router with focused handlers. The first handler set covers `blocklist add` and `blocklist remove`, but the routing model should remain open for future command families.

### Env Contract

Add:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`

`DISCORD_PUBLIC_KEY` is used only for Discord interaction verification. It should not be reused to restore the deleted generic webhook ingress path.

### ModerationStoreDO API

Add a guild-scoped mutation path, for example:

- `POST /guild-emoji`

Expected JSON body:

```json
{
  "guildId": "123",
  "emoji": "✅",
  "action": "add"
}
```

The DO should validate required fields, normalize the emoji, mutate `guild_blocked_emojis`, and return the updated config.

## Error Handling

### Interaction Failures

- Invalid signature returns `401`
- Invalid JSON or unsupported interaction shapes return `400`
- Unknown commands or subcommands return an ephemeral error message
- Non-guild interactions return an ephemeral error message

### Authorization Failures

- Missing required Discord permissions returns an ephemeral denial message
- Permission checks rely on Discord's permission bitset from the interaction payload

### Storage Failures

- DO validation failures return a user-safe ephemeral error message
- Unexpected store failures are logged and return a generic ephemeral failure response

## Verification Strategy

Add focused coverage for:

1. interaction signature verification
2. `PING` handling
3. slash command parsing for add and remove
4. permission gating for Administrator and Manage Guild
5. guild-scoped DO mutations
6. duplicate add and missing remove behavior
7. command sync request construction

Repository validation remains:

- `pnpm test`
- `pnpm run typecheck`
- `npx wrangler deploy --dry-run`

## Notes

- This design intentionally keeps Discord command handling in the Worker and live moderation in `GatewaySessionDO`.
- The deleted legacy compatibility ingress stays deleted; `/interactions` is a narrowly scoped Discord command endpoint with explicit signature verification and Discord interaction semantics.
- Extensibility matters for this feature: new commands should be added by extending a command registry/router and command sync definitions, not by expanding a monolithic handler with unrelated logic.
