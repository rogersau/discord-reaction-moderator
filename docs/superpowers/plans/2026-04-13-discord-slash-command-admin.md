# Discord Slash Command Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Discord server admins manage each guild's blocked emoji list with slash commands handled directly by the Cloudflare Worker.

**Architecture:** Add a narrow `/interactions` route to the Worker, keep command parsing in focused interaction/command modules, and extend `ModerationStoreDO` with guild-scoped emoji mutations. Reuse the existing normalization logic and keep `GatewaySessionDO` unchanged so command handling and live moderation stay decoupled.

**Tech Stack:** TypeScript, Cloudflare Workers, SQLite-backed Durable Objects, Discord interactions API, Node test runner, Wrangler

---

## File Map

- `src/index.ts` — add `/interactions` routing and unify bootstrap so command sync and gateway startup share one entry point.
- `src/env.ts` — add `DISCORD_PUBLIC_KEY` and `DISCORD_APPLICATION_ID`.
- `src/discord.ts` — hold Discord HTTP helpers: reaction delete, interaction signature verification, and application command sync.
- `src/discord-interactions.ts` — protocol helpers for Discord interactions, permission checks, ephemeral responses, and command extraction.
- `src/discord-commands.ts` — extensible command registry plus execution for the first `blocklist` command family.
- `src/durable-objects/moderation-store.ts` — add guild-scoped emoji mutation support without changing the SQLite schema.
- `test/discord-interactions.test.ts` — unit coverage for permission checks, command extraction, and command definition shape.
- `test/blocklist.test.ts` — `ModerationStoreDO` coverage for guild-scoped emoji mutations.
- `test/interaction-routes.test.ts` — Worker interaction endpoint coverage, including signature verification and slash command responses.
- `test/admin-routes.test.ts` — bootstrap coverage for command sync plus existing gateway bootstrap behavior.
- `README.md` — document new vars, Discord portal setup, and slash command usage.
- `wrangler.toml` — expose non-secret command config defaults.

### Task 1: Build the interaction helpers and command registry

**Files:**

- Create: `src/discord-interactions.ts`
- Create: `src/discord-commands.ts`
- Test: `test/discord-interactions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/discord-interactions.test.ts
// @ts-ignore
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADMINISTRATOR_PERMISSION,
  MANAGE_GUILD_PERMISSION,
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "../src/discord-interactions";
import { SLASH_COMMAND_DEFINITIONS } from "../src/discord-commands";

test("hasGuildAdminPermission accepts Administrator and Manage Guild", () => {
  assert.equal(hasGuildAdminPermission(String(ADMINISTRATOR_PERMISSION)), true);
  assert.equal(hasGuildAdminPermission(String(MANAGE_GUILD_PERMISSION)), true);
  assert.equal(hasGuildAdminPermission("1024"), false);
});

test("extractCommandInvocation returns blocklist add and remove requests", () => {
  const interaction = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "add",
          type: 1,
          options: [{ name: "emoji", type: 3, value: "✅" }],
        },
      ],
    },
  };

  assert.deepEqual(extractCommandInvocation(interaction), {
    commandName: "blocklist",
    subcommandName: "add",
    emoji: "✅",
  });
});

test("SLASH_COMMAND_DEFINITIONS exposes the blocklist command tree", () => {
  assert.deepEqual(SLASH_COMMAND_DEFINITIONS, [
    {
      name: "blocklist",
      description: "Manage this server's blocked emoji list",
      options: [
        {
          type: 1,
          name: "add",
          description: "Block an emoji in this server",
          options: [{ type: 3, name: "emoji", description: "Emoji to block", required: true }],
        },
        {
          type: 1,
          name: "remove",
          description: "Unblock an emoji in this server",
          options: [{ type: 3, name: "emoji", description: "Emoji to unblock", required: true }],
        },
      ],
    },
  ]);
});

test("buildEphemeralMessage returns the Discord ephemeral response shape", () => {
  assert.deepEqual(buildEphemeralMessage("Added ✅"), {
    type: 4,
    data: {
      content: "Added ✅",
      flags: 64,
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/discord-interactions.test.js`  
Expected: FAIL with `Cannot find module '../src/discord-interactions'` or missing exported symbol errors.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/discord-interactions.ts
export const ADMINISTRATOR_PERMISSION = 1n << 3n;
export const MANAGE_GUILD_PERMISSION = 1n << 5n;

export function hasGuildAdminPermission(permissions: string): boolean {
  const bits = BigInt(permissions);
  return (bits & ADMINISTRATOR_PERMISSION) !== 0n || (bits & MANAGE_GUILD_PERMISSION) !== 0n;
}

export function extractCommandInvocation(interaction: {
  data?: {
    name?: string;
    options?: Array<{
      name?: string;
      options?: Array<{ name?: string; value?: unknown }>;
    }>;
  };
}): {
  commandName: string;
  subcommandName: string;
  emoji: string;
} | null {
  const commandName = interaction.data?.name;
  const subcommand = interaction.data?.options?.[0];
  const emojiOption = subcommand?.options?.find((option) => option.name === "emoji");

  if (
    typeof commandName !== "string" ||
    typeof subcommand?.name !== "string" ||
    typeof emojiOption?.value !== "string"
  ) {
    return null;
  }

  return {
    commandName,
    subcommandName: subcommand.name,
    emoji: emojiOption.value,
  };
}

export function buildEphemeralMessage(content: string) {
  return {
    type: 4,
    data: {
      content,
      flags: 64,
    },
  };
}
```

```ts
// src/discord-commands.ts
export const SLASH_COMMAND_DEFINITIONS = [
  {
    name: "blocklist",
    description: "Manage this server's blocked emoji list",
    options: [
      {
        type: 1,
        name: "add",
        description: "Block an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to block", required: true }],
      },
      {
        type: 1,
        name: "remove",
        description: "Unblock an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to unblock", required: true }],
      },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/discord-interactions.test.js`  
Expected: PASS for all tests in `discord-interactions.test.js`.

- [ ] **Step 5: Commit**

```bash
git add test/discord-interactions.test.ts src/discord-interactions.ts src/discord-commands.ts
git commit -m "feat: add Discord interaction helpers"
```

### Task 2: Add guild-scoped emoji mutations to `ModerationStoreDO`

**Files:**

- Modify: `src/durable-objects/moderation-store.ts`
- Test: `test/blocklist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("ModerationStoreDO applies guild-scoped emoji add and remove mutations", async () => {
  const store = new ModerationStoreDO(createState(), { BOT_USER_ID: "bot-user-id" } as Env);

  const addResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        emoji: "✅",
        action: "add",
      }),
    }),
  );

  assert.equal(addResponse.status, 200);
  const afterAdd = await addResponse.json();
  assert.deepEqual(afterAdd.guilds["guild-1"], {
    enabled: true,
    emojis: ["✅"],
  });

  const removeResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        emoji: "✅",
        action: "remove",
      }),
    }),
  );

  const afterRemove = await removeResponse.json();
  assert.deepEqual(afterRemove.guilds["guild-1"], {
    enabled: true,
    emojis: [],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/blocklist.test.js --test-name-pattern="guild-scoped emoji add and remove"`  
Expected: FAIL with `404 !== 200` because `/guild-emoji` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/durable-objects/moderation-store.ts
if (request.method === "POST" && url.pathname === "/guild-emoji") {
  try {
    const body = parseGuildEmojiMutation(await request.json());
    return Response.json(this.applyGuildEmojiMutation(body));
  } catch (error) {
    return this.errorResponse(error);
  }
}

private applyGuildEmojiMutation(body: {
  guildId: string;
  emoji: string;
  action: "add" | "remove";
}): BlocklistConfig {
  this.sql.exec(
    "INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, 1)",
    body.guildId
  );

  if (body.action === "add") {
    this.sql.exec(
      "INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)",
      body.guildId,
      body.emoji
    );
  } else {
    this.sql.exec(
      "DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?",
      body.guildId,
      body.emoji
    );
  }

  return this.readConfig();
}

function parseGuildEmojiMutation(body: unknown): {
  guildId: string;
  emoji: string;
  action: "add" | "remove";
} {
  if (!isRecord(body) || typeof body.guildId !== "string") {
    throw new ModerationStoreInputError("Missing guildId");
  }

  const emoji = normalizeEmoji(asOptionalString(body.emoji));
  const action = body.action;

  if (!emoji || (action !== "add" && action !== "remove")) {
    throw new ModerationStoreInputError("Missing emoji or invalid action");
  }

  return { guildId: body.guildId, emoji, action };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/blocklist.test.js --test-name-pattern="guild-scoped emoji add and remove"`  
Expected: PASS for the new guild mutation test.

- [ ] **Step 5: Commit**

```bash
git add test/blocklist.test.ts src/durable-objects/moderation-store.ts
git commit -m "feat: add guild blocklist mutations"
```

### Task 3: Wire the `/interactions` route and slash command execution

**Files:**

- Modify: `src/index.ts`
- Modify: `src/env.ts`
- Modify: `src/discord.ts`
- Create: `test/interaction-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/interaction-routes.test.ts
// @ts-ignore
import test from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index";

test("worker answers Discord PING interactions", async () => {
  const { createSignedRequest, publicKey } = await createInteractionSigner();
  const response = await worker.fetch(
    await createSignedRequest("https://worker.example/interactions", { type: 1 }),
    createEnv({ DISCORD_PUBLIC_KEY: publicKey }),
    {} as ExecutionContext,
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("worker rejects slash commands from members without guild admin permissions", async () => {
  const { createSignedRequest, publicKey } = await createInteractionSigner();
  const response = await worker.fetch(
    await createSignedRequest("https://worker.example/interactions", {
      type: 2,
      guild_id: "guild-1",
      member: { permissions: "1024" },
      data: {
        name: "blocklist",
        options: [
          {
            name: "add",
            type: 1,
            options: [{ name: "emoji", type: 3, value: "✅" }],
          },
        ],
      },
    }),
    createEnv({ DISCORD_PUBLIC_KEY: publicKey }),
    {} as ExecutionContext,
  );

  assert.equal(response.status, 200);
  assert.equal(
    (await response.json()).data.content,
    "You need Administrator or Manage Guild to use this command.",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js`  
Expected: FAIL with `404 !== 200` because `/interactions` is not routed yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/env.ts
export interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  BOT_USER_ID: string;
  ADMIN_AUTH_SECRET?: string;
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
```

```ts
// src/index.ts
if (url.pathname === "/interactions" && request.method === "POST") {
  return handleInteractionRequest(request, env);
}

async function handleInteractionRequest(request: Request, env: Env): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  const body = await request.text();

  const isValid = await verifyDiscordSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);

  if (!isValid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const interaction = JSON.parse(body);
  if (interaction.type === 1) {
    return Response.json({ type: 1 });
  }

  return handleApplicationCommand(interaction, env);
}

async function handleApplicationCommand(
  interaction: {
    guild_id?: string;
    member?: { permissions?: string };
    data?: unknown;
  },
  env: Env,
): Promise<Response> {
  if (!interaction.guild_id) {
    return Response.json(buildEphemeralMessage("This command can only be used in a server."));
  }

  if (!hasGuildAdminPermission(interaction.member?.permissions ?? "0")) {
    return Response.json(
      buildEphemeralMessage("You need Administrator or Manage Guild to use this command."),
    );
  }

  const command = extractCommandInvocation(interaction);
  if (!command) {
    return Response.json(buildEphemeralMessage("Provide a valid unicode or custom emoji."));
  }

  const response = await getModerationStoreStub(env).fetch("https://moderation-store/guild-emoji", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guildId: interaction.guild_id,
      emoji: command.emoji,
      action: command.subcommandName,
    }),
  });

  const content =
    command.subcommandName === "add"
      ? `Added ${command.emoji} to this server's blocked emoji list.`
      : `Removed ${command.emoji} from this server's blocked emoji list.`;

  return Response.json(buildEphemeralMessage(content), { status: response.status });
}
```

```ts
// src/discord.ts
export async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string,
): Promise<boolean> {
  const publicKey = hexToBytes(publicKeyHex);
  const signedPayload = new TextEncoder().encode(timestamp + body);
  const signatureBytes = hexToBytes(signature);
  const cryptoKey = await crypto.subtle.importKey("raw", publicKey, "Ed25519", false, ["verify"]);
  return crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, signedPayload);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js`  
Expected: PASS for the new interaction route tests.

- [ ] **Step 5: Commit**

```bash
git add test/interaction-routes.test.ts src/index.ts src/env.ts src/discord.ts
git commit -m "feat: add Discord interactions endpoint"
```

### Task 4: Sync slash commands during bootstrap and document the setup

**Files:**

- Modify: `src/index.ts`
- Modify: `src/env.ts`
- Modify: `src/discord.ts`
- Modify: `src/discord-commands.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `README.md`
- Modify: `wrangler.toml`

- [ ] **Step 1: Write the failing test**

```ts
test("worker scheduled handler syncs slash commands before starting the gateway session", async () => {
  const calls: string[] = [];
  const env = createEnv({
    DISCORD_APPLICATION_ID: "app-123",
    gatewayFetch: () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    discordFetch: async (input, init) => {
      calls.push(`${init?.method ?? "GET"} ${String(input)}`);
      return new Response(JSON.stringify([{ id: "cmd-1" }]), { status: 200 });
    },
  });

  const waitUntilPromises: Promise<unknown>[] = [];
  worker.scheduled({} as ScheduledController, env, {
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
  } as ExecutionContext);

  await Promise.all(waitUntilPromises);

  assert.deepEqual(calls, [
    "PUT https://discord.com/api/v10/applications/app-123/commands",
    "POST https://gateway-session/start",
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-routes.test.js --test-name-pattern="syncs slash commands before starting the gateway session"`  
Expected: FAIL because scheduled bootstrap currently only starts the gateway session.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/env.ts
export interface Env {
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  BOT_USER_ID: string;
  ADMIN_AUTH_SECRET?: string;
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
```

```ts
// src/discord.ts
import { SLASH_COMMAND_DEFINITIONS } from "./discord-commands";

export async function syncApplicationCommands(
  applicationId: string,
  botToken: string,
): Promise<void> {
  const response = await fetch(
    `https://discord.com/api/v10/applications/${applicationId}/commands`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bot ${botToken}`,
      },
      body: JSON.stringify(SLASH_COMMAND_DEFINITIONS),
    },
  );

  if (!response.ok) {
    throw new Error(`Discord command sync failed (${response.status})`);
  }
}
```

```ts
// src/index.ts
async function bootstrapDiscord(env: Env): Promise<Response> {
  if (env.DISCORD_APPLICATION_ID) {
    try {
      await syncApplicationCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_BOT_TOKEN);
    } catch (error) {
      console.error("Failed to sync slash commands", error);
    }
  }

  return startGatewaySession(env);
}

if (request.method === "POST" && url.pathname === "/admin/gateway/start") {
  return bootstrapDiscord(env);
}

scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
  if (!env.DISCORD_BOT_TOKEN) {
    return;
  }

  ctx.waitUntil(bootstrapDiscord(env));
}
```

```toml
# wrangler.toml
[vars]
BOT_USER_ID = ""
DISCORD_PUBLIC_KEY = ""
DISCORD_APPLICATION_ID = ""
```

```md
<!-- README.md -->

Set these non-secret vars in `wrangler.toml`:

[vars]
BOT_USER_ID = "123456789012345678"
DISCORD_PUBLIC_KEY = "discord-public-key"
DISCORD_APPLICATION_ID = "discord-application-id"

Set the Discord Developer Portal interaction endpoint URL to:

`https://your-worker-url.workers.dev/interactions`

Use these slash commands in a guild where the bot is installed:

- `/blocklist add emoji:✅`
- `/blocklist remove emoji:✅`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-routes.test.js --test-name-pattern="syncs slash commands before starting the gateway session"`  
Expected: PASS for the new bootstrap sync test.

- [ ] **Step 5: Run full validation and commit**

Run:

```bash
pnpm test
pnpm run typecheck
npx wrangler deploy --dry-run
```

Expected:

- `pnpm test` PASS
- `pnpm run typecheck` PASS
- `npx wrangler deploy --dry-run` exits `0`

Commit:

```bash
git add src/index.ts src/env.ts src/discord.ts src/discord-commands.ts test/admin-routes.test.ts README.md wrangler.toml
git commit -m "feat: add Discord slash command bootstrap"
```
