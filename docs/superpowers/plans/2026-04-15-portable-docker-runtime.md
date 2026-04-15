# Portable Docker Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Docker-first, self-contained runtime that can host the bot outside Cloudflare while keeping the current Cloudflare deployment path working.

**Architecture:** Introduce a portable runtime layer that owns HTTP route handling, gateway lifecycle orchestration, scheduling, and storage contracts. Keep `src/index.ts` as the Cloudflare adapter, add a Node adapter backed by local SQLite plus a process-local gateway service and scheduler, and reuse the existing Discord command, moderation, and API helpers instead of forking behavior.

**Tech Stack:** TypeScript, Cloudflare Workers, Node.js, SQLite (`better-sqlite3`), `ws`, Node `http`, Discord HTTP/WebSocket APIs, Node test runner, Docker

---

## File Structure

- Modify: `package.json` — add Node runtime scripts and runtime dependencies.
- Modify: `tsconfig.tests.json` — include new runtime files/tests and Node types for test compilation.
- Create: `tsconfig.node.json` — compile the portable Node runtime into `dist-node/`.
- Create: `src/runtime/node-config.ts` — validate/process env for the portable runtime.
- Create: `src/runtime/contracts.ts` — store/gateway/runtime interfaces shared by adapters.
- Create: `src/runtime/app.ts` — shared `/health`, `/interactions`, `/admin/gateway/*`, and bootstrap orchestration.
- Create: `src/runtime/cloudflare-runtime.ts` — wrap Durable Object-backed Cloudflare behavior behind the shared contracts.
- Create: `src/runtime/sqlite-store.ts` — SQLite-backed store for blocklists, timed roles, app config, and gateway resume state.
- Create: `src/runtime/node-gateway-service.ts` — process-local gateway connection manager using `ws`.
- Create: `src/runtime/node-scheduler.ts` — process-local timed-role expiry loop for the portable runtime.
- Create: `src/runtime/node-server.ts` — Node `http` server that routes requests through the shared runtime app.
- Create: `src/runtime/node-main.ts` — portable runtime entrypoint, startup validation, migrations, scheduler, and shutdown wiring.
- Modify: `src/index.ts` — delegate Cloudflare fetch/scheduled work to the shared runtime app.
- Modify: `src/reaction-moderation.ts` — accept a config loader/store contract instead of only a Durable Object stub.
- Modify: `src/gateway.ts` — parameterize identify properties so Cloudflare and Node can report different runtime labels.
- Create: `test/node-config.test.ts` — config validation tests for the Node runtime.
- Create: `test/runtime-app.test.ts` — shared route/bootstrap tests using fake store/gateway adapters.
- Create: `test/sqlite-store.test.ts` — portable SQLite store tests.
- Create: `test/node-gateway-service.test.ts` — gateway lifecycle tests using a fake WebSocket class.
- Create: `test/node-scheduler.test.ts` — timed-role scheduler tests using a fake clock/store.
- Create: `test/node-server.test.ts` — end-to-end portable server tests against a real local HTTP server.
- Modify: `test/admin-routes.test.ts` — keep Cloudflare admin behavior covered after the adapter split.
- Modify: `test/interaction-routes.test.ts` — keep Cloudflare interaction behavior covered after the adapter split.
- Create: `Dockerfile` — single-container build/run image.
- Create: `.dockerignore` — keep the image small and deterministic.
- Modify: `README.md` — document Docker runtime setup and note that Windows packaging comes later on top of the same portable runtime.

### Task 1: Add Node runtime scaffolding and validated config loading

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.tests.json`
- Create: `tsconfig.node.json`
- Create: `src/runtime/node-config.ts`
- Test: `test/node-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/node-config.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { loadNodeRuntimeConfig } from "../src/runtime/node-config";

test("loadNodeRuntimeConfig returns the validated portable runtime config", () => {
  const config = loadNodeRuntimeConfig({
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: "application-id",
    ADMIN_AUTH_SECRET: "admin-secret",
    PORT: "8787",
    SQLITE_PATH: "./data/runtime.sqlite",
  });

  assert.deepEqual(config, {
    discordBotToken: "bot-token",
    botUserId: "bot-user-id",
    discordPublicKey: "a".repeat(64),
    discordApplicationId: "application-id",
    adminAuthSecret: "admin-secret",
    port: 8787,
    sqlitePath: "./data/runtime.sqlite",
  });
});

test("loadNodeRuntimeConfig rejects missing required values", () => {
  assert.throws(
    () => loadNodeRuntimeConfig({ PORT: "8787", SQLITE_PATH: "./data/runtime.sqlite" }),
    /DISCORD_BOT_TOKEN/
  );
});
```

```json
// tsconfig.tests.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "CommonJS",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "outDir": "dist-tests",
    "rootDir": ".",
    "types": ["@cloudflare/workers-types", "node"],
    "lib": ["ES2022"]
  },
  "include": ["src/**/*.ts", "test/**/*.test.ts"],
  "exclude": ["dist-tests"]
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/node-config.test.js`
Expected: FAIL with `Cannot find module '../src/runtime/node-config'` or an equivalent missing-export error.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
    "build:test": "tsc -p tsconfig.tests.json",
    "build:node": "tsc -p tsconfig.node.json",
    "start:node": "node dist-node/src/runtime/node-main.js",
    "docker:build": "docker build -t discord-automation-workers .",
    "test": "sh -c 'rm -rf dist-tests; pnpm run build:test && node --test dist-tests/test/*.test.js; status=$?; rm -rf dist-tests; exit $status'"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.20241106.0",
    "better-sqlite3": "^11.8.1",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  }
}
```

```json
// tsconfig.node.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist-node",
    "rootDir": ".",
    "types": ["node"],
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts"]
}
```

```ts
// src/runtime/node-config.ts
export interface NodeRuntimeConfig {
  discordBotToken: string;
  botUserId: string;
  discordPublicKey: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  port: number;
  sqlitePath: string;
}

export function loadNodeRuntimeConfig(env: Record<string, string | undefined>): NodeRuntimeConfig {
  const discordBotToken = requireValue(env, "DISCORD_BOT_TOKEN");
  const botUserId = requireValue(env, "BOT_USER_ID");
  const discordPublicKey = requireValue(env, "DISCORD_PUBLIC_KEY");
  const sqlitePath = requireValue(env, "SQLITE_PATH");
  const portText = env.PORT ?? "8787";
  const port = Number.parseInt(portText, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, received: ${portText}`);
  }

  return {
    discordBotToken,
    botUserId,
    discordPublicKey,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    port,
    sqlitePath,
  };
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm run build:test && node --test dist-tests/test/node-config.test.js`
Expected: PASS for both config validation tests.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.tests.json tsconfig.node.json src/runtime/node-config.ts test/node-config.test.ts
git commit -m "build: scaffold portable node runtime"
```

### Task 2: Introduce shared runtime contracts and route orchestration

**Files:**
- Create: `src/runtime/contracts.ts`
- Create: `src/runtime/app.ts`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-app.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createRuntimeApp } from "../src/runtime/app";
import type { GatewayController, RuntimeStore } from "../src/runtime/contracts";

test("createRuntimeApp returns health, interaction ping, slash-command, and admin gateway responses through shared adapters", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    discordApplicationId: "application-id",
    adminAuthSecret: "admin-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { emojis: [], guilds: {}, botUserId: "bot-user-id" };
      },
      async applyGuildEmojiMutation() {
        return { emojis: [], guilds: {}, botUserId: "bot-user-id" };
      },
      async listTimedRolesByGuild() {
        return [];
      },
      async upsertTimedRole() {},
      async deleteTimedRole() {},
      async listExpiredTimedRoles() {
        return [];
      },
      async readGatewaySnapshot() {
        return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
      async writeGatewaySnapshot() {},
    } as RuntimeStore,
    gateway: {
      async start() {
        calls.push("start");
        return { status: "connecting", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
      async status() {
        calls.push("status");
        return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
    } as GatewayController,
  });

  const healthResponse = await app.fetch(new Request("https://runtime.example/health"));
  const pingResponse = await app.fetch(
    new Request("https://runtime.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "ignored-for-ping-test",
        "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ type: 1 }),
    })
  );
  const listResponse = await app.fetch(
    new Request("https://runtime.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "ignored-for-command-test",
        "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({
        type: 2,
        guild_id: "guild-1",
        member: { permissions: "8" },
        data: {
          name: "blocklist",
          options: [{ type: 1, name: "list" }],
        },
      }),
    })
  );
  const statusResponse = await app.fetch(
    new Request("https://runtime.example/admin/gateway/status", {
      headers: { Authorization: "Bearer admin-secret" },
    })
  );

  assert.equal(healthResponse.status, 200);
  assert.equal(await healthResponse.text(), "OK");
  assert.deepEqual(await pingResponse.json(), { type: 1 });
  assert.deepEqual(await listResponse.json(), {
    type: 4,
    data: { flags: 64, content: "No emojis are blocked in this server." },
  });
  assert.deepEqual(await statusResponse.json(), {
    status: "idle",
    sessionId: null,
    resumeGatewayUrl: null,
    lastSequence: null,
    backoffAttempt: 0,
    lastError: null,
    heartbeatIntervalMs: null,
  });
  assert.deepEqual(calls, ["status"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: FAIL because `src/runtime/contracts.ts` and `src/runtime/app.ts` do not exist yet and the shared runtime command path is missing.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/contracts.ts
import type { BlocklistConfig, TimedRoleAssignment } from "../types";

export interface GatewaySnapshot {
  status: "idle" | "connecting" | "ready" | "resuming" | "backoff";
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

export interface RuntimeStore {
  readConfig(): Promise<BlocklistConfig>;
  applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig>;
  listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]>;
  upsertTimedRole(body: TimedRoleAssignment): Promise<void>;
  deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void>;
  listExpiredTimedRoles(nowMs: number): Promise<TimedRoleAssignment[]>;
  readGatewaySnapshot(): Promise<GatewaySnapshot>;
  writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void>;
}

export interface GatewayController {
  start(): Promise<GatewaySnapshot>;
  status(): Promise<GatewaySnapshot>;
}
```

```ts
// src/runtime/app.ts
import { syncApplicationCommands, verifyDiscordSignature } from "../discord";
import {
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "../discord-interactions";
import { formatTimedRoleExpiry, parseTimedRoleDuration } from "../timed-roles";
import type { GatewayController, RuntimeStore } from "./contracts";

interface RuntimeAppOptions {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  store: RuntimeStore;
  gateway: GatewayController;
}

export function createRuntimeApp(options: RuntimeAppOptions) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      if (url.pathname === "/admin/gateway/status") {
        if (!isAuthorized(request, options.adminAuthSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json(await options.gateway.status());
      }

      if (request.method === "POST" && url.pathname === "/admin/gateway/start") {
        if (!isAuthorized(request, options.adminAuthSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json(await bootstrap());
      }

      if (request.method === "POST" && url.pathname === "/interactions") {
        return handleInteractionRequest(request, options);
      }

      return new Response("Not found", { status: 404 });
    },
    bootstrap,
  };

  async function bootstrap() {
    if (options.discordApplicationId) {
      await syncApplicationCommands(options.discordApplicationId, options.discordBotToken);
    }
    return options.gateway.start();
  }
}

async function handleInteractionRequest(
  request: Request,
  options: RuntimeAppOptions
): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response("Unauthorized", { status: 401 });
  }

  const verifyDiscordRequest =
    options.verifyDiscordRequest ??
    ((ts: string, rawBody: string, sig: string) =>
      verifyDiscordSignature(options.discordPublicKey, ts, rawBody, sig));

  if (!(await verifyDiscordRequest(timestamp, body, signature))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isFreshDiscordTimestamp(timestamp)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const interaction = JSON.parse(body);
  if (interaction?.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction?.type === 2) {
    return handleApplicationCommand(interaction, options.store);
  }

  return Response.json(buildEphemeralMessage("Unsupported interaction type."));
}

async function handleApplicationCommand(interaction: any, store: RuntimeStore): Promise<Response> {
  if (typeof interaction?.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This command can only be used inside a server."));
  }
  if (!hasGuildAdminPermission(interaction?.member?.permissions ?? "")) {
    return Response.json(
      buildEphemeralMessage("You need Administrator or Manage Guild permissions to use this command.")
    );
  }

  const invocation = extractCommandInvocation(interaction);
  if (!invocation) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "list") {
    const config = await store.readConfig();
    const guildEmojis = config.guilds?.[interaction.guild_id]?.emojis ?? [];
    return Response.json(
      buildEphemeralMessage(
        guildEmojis.length === 0
          ? "No emojis are blocked in this server."
          : `Blocked emojis in this server:\n${guildEmojis.map((emoji) => `- ${emoji}`).join("\n")}`
      )
    );
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "list") {
    const assignments = await store.listTimedRolesByGuild(interaction.guild_id);
    const content =
      assignments.length === 0
        ? "No timed roles are active in this server."
        : `Active timed roles:\n${assignments.map((assignment) => `<@${assignment.userId}> <@&${assignment.roleId}> until ${formatTimedRoleExpiry(assignment.expiresAtMs)}`).join("\n")}`;
    return Response.json(buildEphemeralMessage(content));
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "add") {
    const parsedDuration = parseTimedRoleDuration(invocation.duration, Date.now());
    if (!parsedDuration) {
      return Response.json(buildEphemeralMessage("Invalid duration. Use values like 1h, 1w, or 1m."));
    }
    await store.upsertTimedRole({
      guildId: interaction.guild_id,
      userId: invocation.userId,
      roleId: invocation.roleId,
      durationInput: parsedDuration.durationInput,
      expiresAtMs: parsedDuration.expiresAtMs,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
    });
    return Response.json(
      buildEphemeralMessage(
        `Assigned <@&${invocation.roleId}> to <@${invocation.userId}> until ${formatTimedRoleExpiry(parsedDuration.expiresAtMs)}.`
      )
    );
  }

  return Response.json(buildEphemeralMessage("Unsupported command."));
}

function isFreshDiscordTimestamp(timestamp: string): boolean {
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestampSeconds) <= 5 * 60;
}

function isAuthorized(request: Request, secret?: string): boolean {
  if (!secret) {
    return true;
  }
  return request.headers.get("Authorization") === `Bearer ${secret}`;
}
```

Before leaving this task, move the existing `/blocklist add`, `/blocklist remove`, and `/timedrole remove` branches out of `src/index.ts` into `handleApplicationCommand` as well so every current Discord command path is shared before the adapters diverge.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: PASS for the shared health, interaction, and admin route test.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/contracts.ts src/runtime/app.ts test/runtime-app.test.ts
git commit -m "refactor: add shared runtime app contracts"
```

### Task 3: Move the Cloudflare worker onto the shared runtime layer

**Files:**
- Create: `src/runtime/cloudflare-runtime.ts`
- Modify: `src/index.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `test/interaction-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/admin-routes.test.ts
test("worker keeps routing /admin/gateway/status through the shared runtime layer", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/gateway/status"),
    createEnv({
      gatewayFetch() {
        return Response.json({ status: "idle" });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "idle" });
});

// test/interaction-routes.test.ts
test("worker still answers Discord PING interactions after the runtime split", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest({ type: 1 });
  const response = await worker.fetch(
    request,
    createEnv({ DISCORD_PUBLIC_KEY: publicKeyHex }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-routes.test.js dist-tests/test/interaction-routes.test.js`
Expected: FAIL because the worker still bypasses the shared runtime adapter and the scheduled/bootstrap path is still Cloudflare-specific.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/cloudflare-runtime.ts
import { createRuntimeApp } from "./app";
import { getModerationStoreStub } from "../reaction-moderation";
import type { Env } from "../env";

export function createCloudflareRuntime(env: Env) {
  const gatewayStub = env.GATEWAY_SESSION_DO.get(
    env.GATEWAY_SESSION_DO.idFromName("gateway-session")
  );
  const storeStub = getModerationStoreStub(env);

  return createRuntimeApp({
    discordPublicKey: env.DISCORD_PUBLIC_KEY,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    store: {
      async readConfig() {
        const response = await storeStub.fetch("https://moderation-store/config");
        return response.json();
      },
      async applyGuildEmojiMutation(body) {
        const response = await storeStub.fetch("https://moderation-store/guild-emoji", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return response.json();
      },
      async listTimedRolesByGuild(guildId) {
        const response = await storeStub.fetch(`https://moderation-store/timed-roles?guildId=${encodeURIComponent(guildId)}`);
        return response.json();
      },
      async upsertTimedRole(body) {
        await storeStub.fetch("https://moderation-store/timed-role", {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      async deleteTimedRole(body) {
        await storeStub.fetch("https://moderation-store/timed-role/remove", {
          method: "POST",
          body: JSON.stringify(body),
        });
      },
      async listExpiredTimedRoles() {
        return [];
      },
      async readGatewaySnapshot() {
        const response = await gatewayStub.fetch("https://gateway-session/status");
        return response.json();
      },
      async writeGatewaySnapshot() {},
    },
    gateway: {
      async start() {
        const response = await gatewayStub.fetch("https://gateway-session/start", { method: "POST" });
        return response.json();
      },
      async status() {
        const response = await gatewayStub.fetch("https://gateway-session/status");
        return response.json();
      },
    },
  });
}
```

```ts
// src/index.ts
import { createCloudflareRuntime } from "./runtime/cloudflare-runtime";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createCloudflareRuntime(env).fetch(request);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const runtime = createCloudflareRuntime(env);
    ctx.waitUntil(runtime.bootstrap());
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-routes.test.js dist-tests/test/interaction-routes.test.js`
Expected: PASS and existing Cloudflare-facing behavior stays unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/cloudflare-runtime.ts src/index.ts test/admin-routes.test.ts test/interaction-routes.test.ts
git commit -m "refactor: route cloudflare worker through shared runtime"
```

### Task 4: Add the SQLite-backed portable store

**Files:**
- Create: `src/runtime/sqlite-store.ts`
- Modify: `src/reaction-moderation.ts`
- Test: `test/sqlite-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/sqlite-store.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createSqliteRuntimeStore } from "../src/runtime/sqlite-store";

test("sqlite runtime store persists blocklist config and gateway session state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });
    await store.applyGuildEmojiMutation({ guildId: "guild-1", emoji: "✅", action: "add" });
    await store.writeGatewaySnapshot({
      status: "ready",
      sessionId: "session-1",
      resumeGatewayUrl: "wss://resume.discord.gg/?v=10&encoding=json",
      lastSequence: 42,
      backoffAttempt: 0,
      lastError: null,
      heartbeatIntervalMs: 45000,
    });

    const config = await store.readConfig();
    const snapshot = await store.readGatewaySnapshot();

    assert.deepEqual(config.guilds["guild-1"], { enabled: true, emojis: ["✅"] });
    assert.equal(snapshot.sessionId, "session-1");
    assert.equal(snapshot.lastSequence, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/sqlite-store.test.js`
Expected: FAIL because the SQLite store and its contract methods do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/sqlite-store.ts
import Database from "better-sqlite3";
import { buildBlocklistConfig, normalizeEmoji } from "../blocklist";
import type { GatewaySnapshot, RuntimeStore } from "./contracts";

export function createSqliteRuntimeStore(options: {
  sqlitePath: string;
  botUserId: string;
}): RuntimeStore {
  const db = new Database(options.sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (guild_id TEXT PRIMARY KEY, moderation_enabled INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS guild_blocked_emojis (guild_id TEXT NOT NULL, normalized_emoji TEXT NOT NULL, PRIMARY KEY (guild_id, normalized_emoji));
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS timed_roles (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, role_id TEXT NOT NULL, duration_input TEXT NOT NULL, expires_at_ms INTEGER NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id, role_id));
    CREATE TABLE IF NOT EXISTS gateway_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  db.prepare("INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)").run("bot_user_id", options.botUserId);

  return {
    async readConfig() {
      const guildRows = db.prepare("SELECT guild_id, moderation_enabled FROM guild_settings").all();
      const emojiRows = db.prepare("SELECT guild_id, normalized_emoji FROM guild_blocked_emojis").all();
      const configRows = db.prepare("SELECT key, value FROM app_config").all();
      return buildBlocklistConfig(guildRows as never, emojiRows as never, configRows as never);
    },
    async applyGuildEmojiMutation(body) {
      if (body.action === "add") {
        db.prepare("INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, 1)").run(body.guildId);
        db.prepare("INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)").run(body.guildId, normalizeEmoji(body.emoji));
      } else {
        db.prepare("DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?").run(body.guildId, normalizeEmoji(body.emoji));
      }
      return this.readConfig();
    },
    async listTimedRolesByGuild(guildId) {
      return db
        .prepare("SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC")
        .all(guildId)
        .map(mapTimedRoleRow);
    },
    async upsertTimedRole(body) {
      const now = Date.now();
      db.prepare(
        "INSERT INTO timed_roles(guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET duration_input = excluded.duration_input, expires_at_ms = excluded.expires_at_ms, updated_at_ms = excluded.updated_at_ms"
      ).run(
        body.guildId,
        body.userId,
        body.roleId,
        body.durationInput,
        body.expiresAtMs,
        body.createdAtMs ?? now,
        body.updatedAtMs ?? now
      );
    },
    async deleteTimedRole(body) {
      db.prepare("DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?").run(
        body.guildId,
        body.userId,
        body.roleId
      );
    },
    async listExpiredTimedRoles(nowMs) {
      return db
        .prepare("SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE expires_at_ms <= ? ORDER BY expires_at_ms ASC")
        .all(nowMs)
        .map(mapTimedRoleRow);
    },
    async readGatewaySnapshot() {
      const rows = db.prepare("SELECT key, value FROM gateway_state").all() as Array<{ key: string; value: string }>;
      const map = new Map(rows.map((row) => [row.key, row.value]));
      return {
        status: (map.get("status") ?? "idle") as GatewaySnapshot["status"],
        sessionId: map.get("session_id") ?? null,
        resumeGatewayUrl: map.get("resume_gateway_url") ?? null,
        lastSequence: map.has("last_sequence") ? Number(map.get("last_sequence")) : null,
        backoffAttempt: map.has("backoff_attempt") ? Number(map.get("backoff_attempt")) : 0,
        lastError: map.get("last_error") ?? null,
        heartbeatIntervalMs: map.has("heartbeat_interval_ms") ? Number(map.get("heartbeat_interval_ms")) : null,
      };
    },
    async writeGatewaySnapshot(snapshot) {
      const entries = [
        ["status", snapshot.status],
        ["session_id", snapshot.sessionId],
        ["resume_gateway_url", snapshot.resumeGatewayUrl],
        ["last_sequence", snapshot.lastSequence === null ? null : String(snapshot.lastSequence)],
        ["backoff_attempt", String(snapshot.backoffAttempt)],
        ["last_error", snapshot.lastError],
        ["heartbeat_interval_ms", snapshot.heartbeatIntervalMs === null ? null : String(snapshot.heartbeatIntervalMs)],
      ] as const;
      for (const [key, value] of entries) {
        if (value === null) {
          db.prepare("DELETE FROM gateway_state WHERE key = ?").run(key);
        } else {
          db.prepare("INSERT INTO gateway_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
        }
      }
    },
  };

  function mapTimedRoleRow(row: any) {
    return {
      guildId: row.guild_id as string,
      userId: row.user_id as string,
      roleId: row.role_id as string,
      durationInput: row.duration_input as string,
      expiresAtMs: row.expires_at_ms as number,
      createdAtMs: row.created_at_ms as number,
      updatedAtMs: row.updated_at_ms as number,
    };
  }
}
```

```ts
// src/reaction-moderation.ts
export async function moderateReactionAdd(
  reaction: DiscordReaction | null,
  env: { DISCORD_BOT_TOKEN: string },
  loadConfig: () => Promise<BlocklistConfig>
): Promise<void> {
  if (!reaction) {
    return;
  }

  const blocklist = await loadConfig();
  // keep the existing blocked-emoji logic and deleteReaction call here
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/sqlite-store.test.js`
Expected: PASS for SQLite-backed config and gateway-state persistence.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/contracts.ts src/runtime/sqlite-store.ts src/reaction-moderation.ts test/sqlite-store.test.ts
git commit -m "feat: add sqlite-backed portable runtime store"
```

### Task 5: Implement the Node gateway service and timed-role scheduler

**Files:**
- Create: `src/runtime/node-gateway-service.ts`
- Create: `src/runtime/node-scheduler.ts`
- Modify: `src/gateway.ts`
- Test: `test/node-gateway-service.test.ts`
- Test: `test/node-scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/node-gateway-service.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createNodeGatewayService } from "../src/runtime/node-gateway-service";

test("node gateway service identifies on HELLO and persists READY state", async () => {
  const sent: string[] = [];
  let onMessage: ((payload: string) => void) | undefined;

  const store = {
    async readConfig() {
      return { emojis: [], guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot(snapshot: any) {
      persisted = snapshot;
    },
  } as any;

  let persisted: any;
  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(url, handlers) {
      onMessage = handlers.onMessage;
      return {
        send(data: string) {
          sent.push(data);
        },
        close() {},
      };
    },
  });

  await gateway.start();
  onMessage?.(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  onMessage?.(JSON.stringify({ op: 0, t: "READY", s: 7, d: { session_id: "session-7", resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json" } }));

  assert.match(sent[0] ?? "", /"op":2/);
  assert.equal(persisted.sessionId, "session-7");
  assert.equal((await gateway.status()).status, "ready");
});
```

```ts
// test/node-scheduler.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createTimedRoleScheduler } from "../src/runtime/node-scheduler";

test("timed role scheduler removes expired roles and deletes successful rows", async () => {
  const removed: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const deleted: Array<{ guildId: string; userId: string; roleId: string }> = [];

  const scheduler = createTimedRoleScheduler({
    now: () => 1_700_000_000_000,
    store: {
      async listExpiredTimedRoles() {
        return [{
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
          durationInput: "1h",
          expiresAtMs: 1_699_999_999_000,
          createdAtMs: 1_699_999_000_000,
          updatedAtMs: 1_699_999_000_000,
        }];
      },
      async deleteTimedRole(body) {
        deleted.push(body);
      },
    } as any,
    removeGuildMemberRole: async (guildId, userId, roleId) => {
      removed.push({ guildId, userId, roleId });
    },
    setTimer(callback) {
      void callback();
      return { stop() {} };
    },
  });

  await scheduler.start();

  assert.deepEqual(removed, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
  assert.deepEqual(deleted, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/node-gateway-service.test.js`
Expected: FAIL because the Node gateway service does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/gateway.ts
export function buildIdentifyPayload(token: string, os = "cloudflare"): GatewayFrame<IdentifyData> {
  return {
    op: GATEWAY_OP_IDENTIFY,
    d: {
      token,
      intents: DEFAULT_GATEWAY_INTENTS,
      properties: {
        os,
        browser: GATEWAY_CLIENT_IDENTITY,
        device: GATEWAY_CLIENT_IDENTITY,
      },
    },
  };
}
```

```ts
// src/runtime/node-gateway-service.ts
import { buildHeartbeatPayload, buildIdentifyPayload, buildResumePayload, nextBackoffMillis, shouldHandleDispatch } from "../gateway";
import { moderateReactionAdd } from "../reaction-moderation";
import type { GatewayController, GatewaySnapshot, RuntimeStore } from "./contracts";

export function createNodeGatewayService(options: {
  botToken: string;
  store: RuntimeStore;
  openWebSocket: (url: string, handlers: {
    onMessage(payload: string): void;
    onClose(): void;
    onError(error: unknown): void;
  }) => { send(data: string): void; close(): void };
}): GatewayController {
  let socket: { send(data: string): void; close(): void } | null = null;
  let snapshot: GatewaySnapshot = {
    status: "idle",
    sessionId: null,
    resumeGatewayUrl: null,
    lastSequence: null,
    backoffAttempt: 0,
    lastError: null,
    heartbeatIntervalMs: null,
  };
  const controller: GatewayController = {
    async start() {
      snapshot = await options.store.readGatewaySnapshot();
      socket = options.openWebSocket(snapshot.resumeGatewayUrl ?? "wss://gateway.discord.gg/?v=10&encoding=json", {
        onMessage(payload) {
          void handleMessage(payload);
        },
        onClose() {
          snapshot = { ...snapshot, status: "backoff", backoffAttempt: snapshot.backoffAttempt + 1 };
          void options.store.writeGatewaySnapshot(snapshot);
          setTimeout(() => { void controller.start(); }, nextBackoffMillis(snapshot.backoffAttempt));
        },
        onError(error) {
          snapshot = { ...snapshot, lastError: String(error) };
          void options.store.writeGatewaySnapshot(snapshot);
        },
      });
      snapshot = { ...snapshot, status: snapshot.sessionId ? "resuming" : "connecting" };
      await options.store.writeGatewaySnapshot(snapshot);
      return snapshot;
    },
    async status() {
      return snapshot;
    },
  };

  async function handleMessage(payload: string): Promise<void> {
    const frame = JSON.parse(payload) as { op: number; t?: string | null; s?: number | null; d?: any };
    if (typeof frame.s === "number") {
      snapshot = { ...snapshot, lastSequence: frame.s };
    }
    if (frame.op === 10 && socket) {
      socket.send(JSON.stringify(
        snapshot.sessionId && snapshot.lastSequence !== null
          ? buildResumePayload(options.botToken, snapshot.sessionId, snapshot.lastSequence)
          : buildIdentifyPayload(options.botToken, "node")
      ));
      return;
    }
    if (frame.t === "READY") {
      snapshot = {
        ...snapshot,
        status: "ready",
        sessionId: frame.d.session_id,
        resumeGatewayUrl: frame.d.resume_gateway_url,
        backoffAttempt: 0,
        lastError: null,
      };
      await options.store.writeGatewaySnapshot(snapshot);
      return;
    }
    if (shouldHandleDispatch({ op: frame.op, t: frame.t ?? null })) {
      await moderateReactionAdd(frame.d, { DISCORD_BOT_TOKEN: options.botToken }, () => options.store.readConfig());
    }
  }

  return controller;
}
```

```ts
// src/runtime/node-scheduler.ts
import type { RuntimeStore } from "./contracts";

export function createTimedRoleScheduler(options: {
  now: () => number;
  store: Pick<RuntimeStore, "listExpiredTimedRoles" | "deleteTimedRole">;
  removeGuildMemberRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  setTimer: (callback: () => Promise<void>, delayMs?: number) => { stop(): void };
}) {
  let timer: { stop(): void } | null = null;

  return {
    async start(): Promise<void> {
      timer = options.setTimer(async () => {
        const expiredAssignments = await options.store.listExpiredTimedRoles(options.now());
        for (const assignment of expiredAssignments) {
          await options.removeGuildMemberRole(
            assignment.guildId,
            assignment.userId,
            assignment.roleId
          );
          await options.store.deleteTimedRole({
            guildId: assignment.guildId,
            userId: assignment.userId,
            roleId: assignment.roleId,
          });
        }
      }, 1_000);
    },
    stop(): void {
      timer?.stop();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/node-gateway-service.test.js dist-tests/test/node-scheduler.test.js`
Expected: PASS for gateway identify/resume persistence and timed-role expiry scheduling.

- [ ] **Step 5: Commit**

```bash
git add src/gateway.ts src/runtime/node-gateway-service.ts src/runtime/node-scheduler.ts test/node-gateway-service.test.ts test/node-scheduler.test.ts
git commit -m "feat: add node gateway runtime services"
```

### Task 6: Add the Node HTTP server, process entrypoint, Docker image, and docs

**Files:**
- Create: `src/runtime/node-server.ts`
- Create: `src/runtime/node-main.ts`
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `README.md`
- Test: `test/node-server.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/node-server.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { once } from "node:events";
import { request } from "node:http";

import { startNodeRuntimeServer } from "../src/runtime/node-server";

test("startNodeRuntimeServer serves /health from the portable runtime", async () => {
  const server = await startNodeRuntimeServer({
    port: 0,
    app: {
      fetch(request: Request) {
        return Promise.resolve(
          new URL(request.url).pathname === "/health"
            ? new Response("OK", { status: 200 })
            : new Response("Not found", { status: 404 })
        );
      },
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/health", method: "GET" }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => resolve(body));
      });
      req.on("error", reject);
      req.end();
    });

    assert.equal(responseBody, "OK");
  } finally {
    server.close();
    await once(server, "close");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/node-server.test.js`
Expected: FAIL because the Node server entrypoint does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/node-server.ts
import { createServer, type Server } from "node:http";

export async function startNodeRuntimeServer(options: {
  port: number;
  app: { fetch(request: Request): Promise<Response> };
}): Promise<Server> {
  const server = createServer(async (req, res) => {
    const chunks: Uint8Array[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      const request = new Request(`http://127.0.0.1${req.url ?? "/"}`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const response = await options.app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(Buffer.from(await response.arrayBuffer()));
    });
  });

  await new Promise<void>((resolve) => server.listen(options.port, "0.0.0.0", resolve));
  return server;
}
```

```ts
// src/runtime/node-main.ts
import { loadNodeRuntimeConfig } from "./node-config";
import { createRuntimeApp } from "./app";
import { createSqliteRuntimeStore } from "./sqlite-store";
import { createNodeGatewayService } from "./node-gateway-service";
import { createTimedRoleScheduler } from "./node-scheduler";
import { startNodeRuntimeServer } from "./node-server";
import WebSocket from "ws";
import { removeGuildMemberRole } from "../discord";

async function main(): Promise<void> {
  const config = loadNodeRuntimeConfig(process.env);
  const store = createSqliteRuntimeStore({
    sqlitePath: config.sqlitePath,
    botUserId: config.botUserId,
  });
  const gateway = createNodeGatewayService({
    botToken: config.discordBotToken,
    store,
    openWebSocket(url, handlers) {
      const socket = new WebSocket(url);
      socket.on("message", (payload) => handlers.onMessage(String(payload)));
      socket.on("close", () => handlers.onClose());
      socket.on("error", (error) => handlers.onError(error));
      return {
        send(data: string) {
          socket.send(data);
        },
        close() {
          socket.close();
        },
      };
    },
  });
  const scheduler = createTimedRoleScheduler({
    now: () => Date.now(),
    store,
    removeGuildMemberRole: (guildId, userId, roleId) =>
      removeGuildMemberRole(guildId, userId, roleId, config.discordBotToken),
    setTimer(callback, delayMs = 1_000) {
      const timer = setInterval(() => {
        void callback();
      }, delayMs);
      return {
        stop() {
          clearInterval(timer);
        },
      };
    },
  });
  const app = createRuntimeApp({
    discordPublicKey: config.discordPublicKey,
    discordBotToken: config.discordBotToken,
    discordApplicationId: config.discordApplicationId,
    adminAuthSecret: config.adminAuthSecret,
    store,
    gateway,
  });
  await startNodeRuntimeServer({ port: config.port, app });
  await gateway.start();
  await scheduler.start();
}

void main();
```

```dockerfile
# Dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build:node

FROM node:22-bookworm-slim
WORKDIR /app
ENV PORT=8787
COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist-node ./dist-node
EXPOSE 8787
CMD ["node", "dist-node/src/runtime/node-main.js"]
```

```dockerignore
node_modules
dist-tests
dist-node
.git
```

```md
<!-- README.md -->
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
     -e SQLITE_PATH=/data/runtime.sqlite \
     -v "$PWD/data:/data" \
     discord-automation-workers
   ```

This container hosts the HTTP API, Discord gateway connection, scheduler, and SQLite database in one process. Windows packaging can build on the same portable runtime later, but it is not part of this phase.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/node-server.test.js && pnpm run typecheck`
Expected: PASS for the portable HTTP server test and no type errors across Cloudflare + Node configs.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/node-server.ts src/runtime/node-main.ts Dockerfile .dockerignore README.md test/node-server.test.ts
git commit -m "feat: add docker-first portable runtime"
```

### Task 7: Run full verification for both deployment paths

**Files:**
- Modify: `README.md` if any command/output mismatches are discovered

- [ ] **Step 1: Run the complete automated checks**

```bash
pnpm test
pnpm run typecheck
pnpm exec wrangler deploy --dry-run
docker build -t discord-automation-workers .
```

- [ ] **Step 2: Fix failures in the matching surface before moving on**

- `pnpm test` failure in `admin-routes` or `interaction-routes` → fix `src/index.ts` and `src/runtime/cloudflare-runtime.ts`
- `pnpm test` failure in `sqlite-store`, `node-gateway-service`, or `node-server` → fix the specific file under `src/runtime/`
- `pnpm run typecheck` failure → fix `tsconfig.node.json`, `src/runtime/*`, or any shared type drift in `src/gateway.ts` / `src/reaction-moderation.ts`
- `pnpm exec wrangler deploy --dry-run` failure → fix `wrangler.toml`, `package.json`, or Cloudflare adapter exports without removing the portable runtime code
- `docker build` failure → fix `Dockerfile`, `.dockerignore`, or `package.json` scripts/dependencies

- [ ] **Step 3: Re-run the exact failing command until it passes**

Run: re-run only the failing command from Step 1, then re-run the full list once everything is green.
Expected: PASS for tests, typecheck, Wrangler dry run, and Docker build.

- [ ] **Step 4: Commit the final verification/documentation touch-up if needed**

```bash
git add README.md
git commit -m "docs: finalize portable runtime rollout notes"
```
