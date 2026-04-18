# Cloudflare-Only Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Node/Docker runtime and refactor the app into a clean Cloudflare-native architecture with smaller route, client, and service boundaries.

**Architecture:** Keep Cloudflare Workers plus Durable Objects as the only runtime model. Replace portability-driven contracts with Cloudflare-native clients, split `src/runtime/app.ts` into focused route modules, extract workflow services for admin and interactions, and narrow `GatewaySessionDO` back to gateway lifecycle plus delegated event handling.

**Tech Stack:** TypeScript, Cloudflare Workers, Durable Objects with SQLite storage, React admin UI, Node test runner, Vite, Wrangler, Discord HTTP/WebSocket APIs

---

## File Structure

- Modify: `package.json` — remove Node/Docker scripts and runtime dependencies that only supported the portable runtime.
- Modify: `README.md` — document Cloudflare-only deployment and remove standalone-hosting instructions.
- Modify: `src/env.ts` — add an explicit `ADMIN_SESSION_SECRET` and keep Cloudflare bindings aligned with the new auth model.
- Modify: `wrangler.toml` — document the new session secret requirement in comments and bindings.
- Delete: `Dockerfile`
- Delete: `tsconfig.node.json`
- Delete: `src/runtime/contracts.ts`
- Delete: `src/runtime/node-config.ts`
- Delete: `src/runtime/node-gateway-service.ts`
- Delete: `src/runtime/node-main.ts`
- Delete: `src/runtime/node-runtime.ts`
- Delete: `src/runtime/node-scheduler.ts`
- Delete: `src/runtime/node-server.ts`
- Delete: `src/runtime/sqlite-store.ts`
- Create: `src/runtime/cloudflare-context.ts` — build the Cloudflare request context once and expose typed clients plus auth config.
- Create: `src/runtime/cloudflare-store-client.ts` — the only module that knows the internal `MODERATION_STORE_DO` request paths.
- Create: `src/runtime/cloudflare-gateway-client.ts` — the only module that knows the internal `GATEWAY_SESSION_DO` request paths.
- Create: `src/routes/public-routes.ts` — health and admin asset/shell routing.
- Create: `src/routes/admin-routes.ts` — session-protected admin API routing and dashboard shell routes.
- Create: `src/routes/interaction-routes.ts` — Discord interaction routing, signature verification, and dispatch.
- Create: `src/services/blocklist-service.ts` — blocklist mutations and formatting for admin/interaction flows.
- Create: `src/services/timed-role-service.ts` — timed-role assign/remove/list orchestration.
- Create: `src/services/ticket-service.ts` — ticket panel publish/open/close workflows.
- Create: `src/services/admin-overview-service.ts` — overview, guild directory, permission-check aggregation.
- Create: `src/services/gateway-service.ts` — gateway bootstrap/status orchestration outside route handlers.
- Create: `src/services/reaction-moderation-service.ts` — gateway event moderation logic used by `GatewaySessionDO`.
- Modify: `src/runtime/app.ts` — shrink to route composition only.
- Modify: `src/runtime/cloudflare-runtime.ts` — build Cloudflare-native context instead of portable contracts.
- Modify: `src/runtime/admin-auth.ts` — sign sessions with a dedicated secret only.
- Modify: `src/runtime/admin-permissions.ts` — keep permission logic reusable after route/service extraction.
- Modify: `src/durable-objects/gateway-session.ts` — delegate moderation behavior to the extracted service.
- Modify: `src/reaction-moderation.ts` — keep only the stub helper if still needed or fold it into the store client layer.
- Modify: `test/runtime-app.test.ts` — cover the new route composition and removal of legacy endpoints.
- Modify: `test/admin-routes.test.ts` — cover session-only admin behavior and dropped legacy gateway routes.
- Modify: `test/interaction-routes.test.ts` — cover the extracted interaction routing and service usage.
- Modify: `test/gateway-session.test.ts` — cover delegated gateway event handling.
- Modify: `test/worker-tsconfig.test.ts` — ensure worker compilation no longer references Node runtime artifacts.
- Delete: `test/node-config.test.ts`
- Delete: `test/node-gateway-service.test.ts`
- Delete: `test/node-runtime.test.ts`
- Delete: `test/node-scheduler.test.ts`
- Delete: `test/node-server.test.ts`
- Delete: `test/sqlite-store.test.ts`
- Create: `test/cloudflare-store-client.test.ts` — DO client contract tests.
- Create: `test/cloudflare-gateway-client.test.ts` — gateway client contract tests.
- Create: `test/timed-role-service.test.ts`
- Create: `test/ticket-service.test.ts`
- Create: `test/reaction-moderation-service.test.ts`

### Task 1: Remove the unsupported Node/Docker build surface

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `test/worker-tsconfig.test.ts`
- Delete: `Dockerfile`
- Delete: `tsconfig.node.json`
- Delete: `src/runtime/node-config.ts`
- Delete: `src/runtime/node-gateway-service.ts`
- Delete: `src/runtime/node-main.ts`
- Delete: `src/runtime/node-runtime.ts`
- Delete: `src/runtime/node-scheduler.ts`
- Delete: `src/runtime/node-server.ts`
- Delete: `src/runtime/sqlite-store.ts`
- Delete: `test/node-config.test.ts`
- Delete: `test/node-gateway-service.test.ts`
- Delete: `test/node-runtime.test.ts`
- Delete: `test/node-scheduler.test.ts`
- Delete: `test/node-server.test.ts`
- Delete: `test/sqlite-store.test.ts`
- Test: `test/worker-tsconfig.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/worker-tsconfig.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("Cloudflare-only package scripts no longer expose portable runtime commands", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts["build:node"], undefined);
  assert.equal(packageJson.scripts["start:node"], undefined);
  assert.equal(packageJson.scripts["docker:build"], undefined);
});

test("worker tsconfig explainFiles no longer references removed node runtime files", () => {
  const result = spawnSync("pnpm", ["exec", "tsc", "--noEmit", "--explainFiles"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const explainFiles = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, explainFiles);
  assert.doesNotMatch(explainFiles, /src\/runtime\/node-main\.ts/);
  assert.doesNotMatch(explainFiles, /src\/runtime\/node-gateway-service\.ts/);
  assert.doesNotMatch(explainFiles, /tsconfig\.node\.json/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/worker-tsconfig.test.js`

Expected: FAIL because `package.json` still contains `build:node`, `start:node`, and `docker:build`, and the repository still contains Node runtime artifacts.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "build:admin": "vite build -c vite.admin.config.ts && node scripts/embed-admin-build.mjs",
    "typecheck": "pnpm run build:admin && tsc --noEmit",
    "build:test": "tsc -p tsconfig.tests.json",
    "test": "sh -c 'rm -rf dist-tests; pnpm run build:admin && pnpm run build:test && node --test dist-tests/test/*.test.js; status=$?; rm -rf dist-tests; exit $status'"
  },
  "dependencies": {
    "@cloudflare/workers-types": "^4.20241106.0",
    "@radix-ui/react-alert-dialog": "^1.1.4",
    "@radix-ui/react-label": "^2.1.1",
    "@radix-ui/react-slot": "^1.1.1",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.6.0",
    "zod": "^3.23.8"
  }
}
```

```txt
<!-- README.md -->
## Run outside Cloudflare with Docker

This section is removed. Replace it with a short Cloudflare-only note:

## Hosting model

This project now targets Cloudflare Workers and Durable Objects only. Standalone Node and Docker hosting are no longer supported deployment paths.
```

```txt
# Delete these files
Dockerfile
tsconfig.node.json
src/runtime/node-config.ts
src/runtime/node-gateway-service.ts
src/runtime/node-main.ts
src/runtime/node-runtime.ts
src/runtime/node-scheduler.ts
src/runtime/node-server.ts
src/runtime/sqlite-store.ts
test/node-config.test.ts
test/node-gateway-service.test.ts
test/node-runtime.test.ts
test/node-scheduler.test.ts
test/node-server.test.ts
test/sqlite-store.test.ts
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/worker-tsconfig.test.js`

Expected: PASS for both build-surface assertions.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md test/worker-tsconfig.test.ts
git add -u Dockerfile tsconfig.node.json src/runtime/node-config.ts src/runtime/node-gateway-service.ts src/runtime/node-main.ts src/runtime/node-runtime.ts src/runtime/node-scheduler.ts src/runtime/node-server.ts src/runtime/sqlite-store.ts test/node-config.test.ts test/node-gateway-service.test.ts test/node-runtime.test.ts test/node-scheduler.test.ts test/node-server.test.ts test/sqlite-store.test.ts
git commit -m "refactor: remove portable runtime surface"
```

### Task 2: Introduce Cloudflare-native context and typed Durable Object clients

**Files:**
- Create: `src/runtime/cloudflare-context.ts`
- Create: `src/runtime/cloudflare-store-client.ts`
- Create: `src/runtime/cloudflare-gateway-client.ts`
- Modify: `src/runtime/cloudflare-runtime.ts`
- Modify: `src/env.ts`
- Modify: `wrangler.toml`
- Test: `test/cloudflare-store-client.test.ts`
- Test: `test/cloudflare-gateway-client.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/cloudflare-store-client.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { createCloudflareStoreClient } from "../src/runtime/cloudflare-store-client";

test("createCloudflareStoreClient uses typed methods instead of exposing raw fetches", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json({ ok: true, guilds: {}, botUserId: "bot-user-id" }));
    },
  });

  await storeClient.readConfig();
  await storeClient.applyGuildEmojiMutation({ guildId: "guild-1", emoji: "✅", action: "add" });

  assert.deepEqual(requests, [
    { url: "https://moderation-store/config", method: "GET", body: null },
    {
      url: "https://moderation-store/guild-emoji",
      method: "POST",
      body: JSON.stringify({ guildId: "guild-1", emoji: "✅", action: "add" }),
    },
  ]);
});
```

```ts
// test/cloudflare-gateway-client.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { createCloudflareGatewayClient } from "../src/runtime/cloudflare-gateway-client";

test("createCloudflareGatewayClient wraps gateway status and bootstrap calls", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const gatewayClient = createCloudflareGatewayClient({
    fetch(input, init) {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(
        Response.json({
          status: "idle",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        })
      );
    },
  });

  await gatewayClient.status();
  await gatewayClient.start();

  assert.deepEqual(requests, [
    { url: "https://gateway-session/status", method: "GET" },
    { url: "https://gateway-session/start", method: "POST" },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/cloudflare-store-client.test.js dist-tests/test/cloudflare-gateway-client.test.js`

Expected: FAIL with missing-module errors for the new Cloudflare client files.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/cloudflare-store-client.ts
import type { DurableObjectStub } from "@cloudflare/workers-types";

export function createCloudflareStoreClient(storeStub: Pick<DurableObjectStub, "fetch">) {
  return {
    async readConfig() {
      return readJson(storeStub.fetch("https://moderation-store/config"));
    },
    async applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }) {
      return readJson(
        storeStub.fetch("https://moderation-store/guild-emoji", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async upsertAppConfig(body: { key: string; value: string }) {
      return readJson(
        storeStub.fetch("https://moderation-store/app-config", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async listTimedRolesByGuild(guildId: string) {
      return readJson(
        storeStub.fetch(`https://moderation-store/timed-roles?guildId=${encodeURIComponent(guildId)}`)
      );
    },
    async upsertTimedRole(body: {
      guildId: string;
      userId: string;
      roleId: string;
      durationInput: string;
      expiresAtMs: number;
    }) {
      return readJson(
        storeStub.fetch("https://moderation-store/timed-role", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
  };
}

async function readJson(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  if (!response.ok) {
    throw new Error(`Cloudflare store request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}
```

```ts
// src/runtime/cloudflare-gateway-client.ts
import type { DurableObjectStub } from "@cloudflare/workers-types";

export function createCloudflareGatewayClient(gatewayStub: Pick<DurableObjectStub, "fetch">) {
  return {
    async start() {
      return readJson(gatewayStub.fetch("https://gateway-session/start", { method: "POST" }));
    },
    async status() {
      return readJson(gatewayStub.fetch("https://gateway-session/status"));
    },
  };
}

async function readJson(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  if (!response.ok) {
    throw new Error(`Cloudflare gateway request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}
```

```ts
// src/runtime/cloudflare-context.ts
import type { Env } from "../env";
import { assertValidDiscordPublicKey } from "../discord";
import { getModerationStoreStub } from "../reaction-moderation";
import { createCloudflareStoreClient } from "./cloudflare-store-client";
import { createCloudflareGatewayClient } from "./cloudflare-gateway-client";

export interface RuntimeAppContext {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminUiPassword?: string;
  adminSessionSecret?: string;
  storeClient: ReturnType<typeof createCloudflareStoreClient>;
  gatewayClient: ReturnType<typeof createCloudflareGatewayClient>;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
}

export function createCloudflareContext(env: Env) {
  const gatewayStub = env.GATEWAY_SESSION_DO.get(env.GATEWAY_SESSION_DO.idFromName("gateway-session"));
  const storeStub = getModerationStoreStub(env);

  const context: RuntimeAppContext = {
    discordPublicKey: assertValidDiscordPublicKey(env.DISCORD_PUBLIC_KEY),
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminUiPassword: env.ADMIN_UI_PASSWORD,
    adminSessionSecret: env.ADMIN_SESSION_SECRET,
    storeClient: createCloudflareStoreClient(storeStub),
    gatewayClient: createCloudflareGatewayClient(gatewayStub),
  };

  return context;
}
```

```ts
// src/env.ts
export interface Env {
  DISCORD_BOT_TOKEN: string;
  BOT_USER_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  ADMIN_UI_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
```

```toml
# wrangler.toml
# wrangler secret put ADMIN_UI_PASSWORD
# wrangler secret put ADMIN_SESSION_SECRET
```

```ts
// src/runtime/cloudflare-runtime.ts
import type { Env } from "../env";
import { createRuntimeApp } from "./app";
import { createCloudflareContext } from "./cloudflare-context";

export function createCloudflareRuntime(env: Env) {
  const context = createCloudflareContext(env);
  return createRuntimeApp(context);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/cloudflare-store-client.test.js dist-tests/test/cloudflare-gateway-client.test.js`

Expected: PASS for both client contract tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/cloudflare-context.ts src/runtime/cloudflare-store-client.ts src/runtime/cloudflare-gateway-client.ts src/runtime/cloudflare-runtime.ts src/env.ts wrangler.toml test/cloudflare-store-client.test.ts test/cloudflare-gateway-client.test.ts
git commit -m "refactor: add cloudflare-native runtime clients"
```

### Task 3: Split `app.ts` into route modules and remove legacy gateway routes

**Files:**
- Create: `src/routes/public-routes.ts`
- Create: `src/routes/admin-routes.ts`
- Create: `src/routes/interaction-routes.ts`
- Modify: `src/runtime/app.ts`
- Modify: `test/runtime-app.test.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `test/interaction-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp returns 404 for removed legacy /admin/gateway/status", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    storeClient: {} as never,
    gatewayClient: { status: async () => ({ status: "idle" }), start: async () => ({ status: "idle" }) } as never,
    verifyDiscordRequest: async () => true,
  });

  const response = await app.fetch(new Request("https://runtime.example/admin/gateway/status"));
  assert.equal(response.status, 404);
});

test("createRuntimeApp still serves /health and /admin/api/gateway/status through composed routes", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    storeClient: { readConfig: async () => ({ guilds: {}, botUserId: "bot-user-id" }) } as never,
    gatewayClient: {
      status: async () => ({
        status: "idle",
        sessionId: null,
        resumeGatewayUrl: null,
        lastSequence: null,
        backoffAttempt: 0,
        lastError: null,
        heartbeatIntervalMs: null,
      }),
      start: async () => ({
        status: "connecting",
        sessionId: null,
        resumeGatewayUrl: null,
        lastSequence: null,
        backoffAttempt: 0,
        lastError: null,
        heartbeatIntervalMs: null,
      }),
    } as never,
    verifyDiscordRequest: async () => true,
  });

  const cookie = await createAdminSessionCookie("session-secret");
  const response = await app.fetch(new Request("https://runtime.example/admin/api/gateway/status", { headers: { cookie } }));
  assert.equal(response.status, 200);
});
```

```ts
// test/admin-routes.test.ts
test("admin API requires a valid session cookie and does not accept legacy bearer auth", async () => {
  const response = await app.fetch(
    new Request("https://runtime.example/admin/api/gateway/status", {
      headers: { authorization: "Bearer old-secret" },
    })
  );

  assert.equal(response.status, 401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js dist-tests/test/admin-routes.test.js`

Expected: FAIL because `createRuntimeApp` still serves `/admin/gateway/*` and still accepts legacy bearer-auth behavior.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/routes/public-routes.ts
import { ADMIN_ASSETS, ADMIN_LOGIN_HTML } from "../runtime/admin-bundle";

export function handlePublicRoutes(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/health") return new Response("OK", { status: 200 });
  if (request.method === "GET" && url.pathname.startsWith("/admin/assets/")) {
    const filename = url.pathname.slice("/admin/assets/".length);
    const asset = ADMIN_ASSETS[filename];
    return asset
      ? new Response(asset.content, { status: 200, headers: { "content-type": asset.contentType } })
      : new Response("Not found", { status: 404 });
  }
  if (request.method === "GET" && url.pathname === "/admin/login") {
    return new Response(ADMIN_LOGIN_HTML, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  return null;
}
```

```ts
// src/routes/admin-routes.ts
export async function handleAdminRoutes(request: Request, context: RuntimeAppContext) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/admin")) return null;

  if (request.method === "POST" && url.pathname === "/admin/logout") {
    return new Response(null, {
      status: 302,
      headers: {
        location: "/admin/login",
        "set-cookie": `${ADMIN_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
      },
    });
  }

  if (url.pathname.startsWith("/admin/api/")) {
    const unauthorized = await requireAdminSession(request, context);
    if (unauthorized) return unauthorized;

    if (request.method === "GET" && url.pathname === "/admin/api/gateway/status") {
      return Response.json(await context.gatewayClient.status());
    }
    if (request.method === "POST" && url.pathname === "/admin/api/gateway/start") {
      return Response.json(await context.gatewayClient.start());
    }
  }

  return new Response("Not found", { status: 404 });
}
```

```ts
// src/runtime/app.ts
import { handlePublicRoutes } from "../routes/public-routes";
import { handleAdminRoutes } from "../routes/admin-routes";
import { handleInteractionRoutes } from "../routes/interaction-routes";

export function createRuntimeApp(context: RuntimeAppContext) {
  return {
    async fetch(request: Request): Promise<Response> {
      return (
        (await handlePublicRoutes(request)) ??
        (await handleAdminRoutes(request, context)) ??
        (await handleInteractionRoutes(request, context)) ??
        new Response("Not found", { status: 404 })
      );
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js dist-tests/test/admin-routes.test.js`

Expected: PASS for the removed-legacy-route checks and existing admin route coverage.

- [ ] **Step 5: Commit**

```bash
git add src/routes/public-routes.ts src/routes/admin-routes.ts src/routes/interaction-routes.ts src/runtime/app.ts test/runtime-app.test.ts test/admin-routes.test.ts test/interaction-routes.test.ts
git commit -m "refactor: split runtime routes for cloudflare only"
```

### Task 4: Extract service workflows and require a dedicated admin session secret

**Files:**
- Create: `src/services/blocklist-service.ts`
- Create: `src/services/timed-role-service.ts`
- Create: `src/services/ticket-service.ts`
- Create: `src/services/admin-overview-service.ts`
- Create: `src/services/gateway-service.ts`
- Modify: `src/runtime/admin-auth.ts`
- Modify: `src/routes/admin-routes.ts`
- Modify: `src/routes/interaction-routes.ts`
- Modify: `src/env.ts`
- Modify: `README.md`
- Test: `test/timed-role-service.test.ts`
- Test: `test/ticket-service.test.ts`
- Modify: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/timed-role-service.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { assignTimedRole } from "../src/services/timed-role-service";

test("assignTimedRole rolls back persisted state when Discord role assignment fails", async () => {
  const writes: string[] = [];
  await assert.rejects(
    () =>
      assignTimedRole({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        duration: "1h",
        nowMs: () => 1_700_000_000_000,
        storeClient: {
          upsertTimedRole: async () => void writes.push("upsert"),
          deleteTimedRole: async () => void writes.push("rollback"),
          listTimedRolesByGuild: async () => [],
        } as never,
        discordApi: {
          addGuildMemberRole: async () => {
            throw new Error("discord failed");
          },
        } as never,
      }),
    /discord failed/
  );

  assert.deepEqual(writes, ["upsert", "rollback"]);
});
```

```ts
// test/runtime-app.test.ts
test("createRuntimeApp refuses admin login when ADMIN_SESSION_SECRET is missing", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    storeClient: {} as never,
    gatewayClient: {} as never,
    verifyDiscordRequest: async () => true,
  });

  const response = await app.fetch(
    new Request("https://runtime.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
    })
  );

  assert.equal(response.status, 404);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/timed-role-service.test.js dist-tests/test/runtime-app.test.js`

Expected: FAIL because the service module does not exist yet and login still works with the password-only session-secret fallback.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/timed-role-service.ts
import { parseTimedRoleDuration } from "../timed-roles";

export async function assignTimedRole(input: {
  guildId: string;
  userId: string;
  roleId: string;
  duration: string;
  nowMs: () => number;
  storeClient: {
    upsertTimedRole(body: {
      guildId: string;
      userId: string;
      roleId: string;
      durationInput: string;
      expiresAtMs: number;
    }): Promise<unknown>;
    deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<unknown>;
  };
  discordApi: {
    addGuildMemberRole(guildId: string, userId: string, roleId: string, botToken: string): Promise<unknown>;
  };
  discordBotToken: string;
}) {
  const parsedDuration = parseTimedRoleDuration(input.duration, input.nowMs());
  if (!parsedDuration) {
    throw new Error("Invalid duration");
  }

  await input.storeClient.upsertTimedRole({
    guildId: input.guildId,
    userId: input.userId,
    roleId: input.roleId,
    durationInput: parsedDuration.durationInput,
    expiresAtMs: parsedDuration.expiresAtMs,
  });

  try {
    await input.discordApi.addGuildMemberRole(
      input.guildId,
      input.userId,
      input.roleId,
      input.discordBotToken
    );
  } catch (error) {
    await input.storeClient.deleteTimedRole({
      guildId: input.guildId,
      userId: input.userId,
      roleId: input.roleId,
    });
    throw error;
  }
}
```

```ts
// src/runtime/admin-auth.ts
export async function createAdminSessionCookie(
  secret: string,
  options?: { secure?: boolean },
  nowMs = Date.now()
) {
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required to sign admin sessions.");
  }

  const payload = { exp: nowMs + 60 * 60 * 24 * 7 * 1000 };
  const encodedPayload = encodeURIComponent(JSON.stringify(payload));
  const signature = await signValue(secret, encodedPayload);
  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodedPayload}.${signature}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (options?.secure) attributes.push("Secure");
  return attributes.join("; ");
}
```

```ts
// src/routes/admin-routes.ts
if (request.method === "POST" && url.pathname === "/admin/login") {
  if (!context.adminUiPassword || !context.adminSessionSecret) {
    return new Response("Admin login is not configured.", { status: 404 });
  }
  return handleAdminLogin(request, context);
}
```

```txt
// README.md
### 3. Configure Wrangler variables and secrets

Then add the runtime secrets:

wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put ADMIN_UI_PASSWORD
wrangler secret put ADMIN_SESSION_SECRET
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/timed-role-service.test.js dist-tests/test/ticket-service.test.js dist-tests/test/runtime-app.test.js`

Expected: PASS for the service orchestration tests and the dedicated-session-secret login check.

- [ ] **Step 5: Commit**

```bash
git add src/services/blocklist-service.ts src/services/timed-role-service.ts src/services/ticket-service.ts src/services/admin-overview-service.ts src/services/gateway-service.ts src/runtime/admin-auth.ts src/routes/admin-routes.ts src/routes/interaction-routes.ts src/env.ts README.md test/timed-role-service.test.ts test/ticket-service.test.ts test/runtime-app.test.ts
git commit -m "refactor: extract admin and interaction services"
```

### Task 5: Narrow `GatewaySessionDO` to gateway lifecycle plus delegated event handling

**Files:**
- Create: `src/services/reaction-moderation-service.ts`
- Modify: `src/durable-objects/gateway-session.ts`
- Modify: `src/reaction-moderation.ts`
- Modify: `test/gateway-session.test.ts`
- Create: `test/reaction-moderation-service.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/reaction-moderation-service.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { handleReactionModerationEvent } from "../src/services/reaction-moderation-service";

test("handleReactionModerationEvent deletes blocked reactions and ignores the bot's own reactions", async () => {
  const deleted: string[] = [];

  await handleReactionModerationEvent({
    reaction: {
      channel_id: "channel-1",
      message_id: "message-1",
      guild_id: "guild-1",
      user_id: "user-1",
      emoji: { id: null, name: "✅", animated: false },
    },
    storeClient: {
      readConfig: async () => ({
        botUserId: "bot-user-id",
        guilds: { "guild-1": { enabled: true, emojis: ["✅"] } },
      }),
    } as never,
    discordApi: {
      deleteReaction: async (_channelId, messageId) => {
        deleted.push(messageId);
      },
    } as never,
  });

  assert.deepEqual(deleted, ["message-1"]);
});
```

```ts
// test/gateway-session.test.ts
import * as moderationService from "../src/services/reaction-moderation-service";

test("GatewaySessionDO delegates reaction events through the extracted moderation handler", async () => {
  const delegatedMessageIds: string[] = [];
  const originalHandler = moderationService.handleReactionModerationEvent;
  // @ts-expect-error -- test shim
  moderationService.handleReactionModerationEvent = async ({ reaction }) => {
    delegatedMessageIds.push(reaction?.message_id ?? "missing");
  };

  try {
    const { durableObject } = createGatewaySessionHarness();
    await durableObject.fetch(
      new Request("https://gateway-session/message", {
        method: "POST",
        body: JSON.stringify({
          op: 0,
          t: "MESSAGE_REACTION_ADD",
          d: {
            channel_id: "channel-1",
            message_id: "message-1",
            guild_id: "guild-1",
            user_id: "user-1",
            emoji: { id: null, name: "✅", animated: false },
          },
        }),
      })
    );

    assert.deepEqual(delegatedMessageIds, ["message-1"]);
  } finally {
    // @ts-expect-error -- test shim
    moderationService.handleReactionModerationEvent = originalHandler;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/reaction-moderation-service.test.js dist-tests/test/gateway-session.test.js`

Expected: FAIL because the new moderation service does not exist and `GatewaySessionDO` still embeds the behavior directly.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/services/reaction-moderation-service.ts
import { isEmojiBlocked, normalizeEmoji } from "../blocklist";
import type { DiscordReaction } from "../types";

export async function handleReactionModerationEvent(input: {
  reaction: DiscordReaction | null;
  storeClient: { readConfig(): Promise<{ botUserId: string; guilds: Record<string, { enabled: boolean; emojis: string[] }> }> };
  discordApi: { deleteReaction(channelId: string, messageId: string, emoji: DiscordReaction["emoji"], userId: string): Promise<void> };
}) {
  if (!input.reaction) return;

  const emojiName = normalizeEmoji(input.reaction.emoji.name);
  const emojiId =
    input.reaction.emoji.id && input.reaction.emoji.name
      ? `${input.reaction.emoji.name}:${input.reaction.emoji.id}`
      : emojiName;
  if (!emojiId) return;

  const config = await input.storeClient.readConfig();
  if (input.reaction.user_id === config.botUserId) return;
  if (!isEmojiBlocked(emojiId, config, input.reaction.guild_id)) return;

  await input.discordApi.deleteReaction(
    input.reaction.channel_id,
    input.reaction.message_id,
    input.reaction.emoji,
    input.reaction.user_id
  );
}
```

```ts
// src/durable-objects/gateway-session.ts
import { handleReactionModerationEvent } from "../services/reaction-moderation-service";

if (shouldHandleDispatch({ op: payload.op, t: payload.t ?? null })) {
  await handleReactionModerationEvent({
    reaction: payload.d as DiscordReaction | null,
    storeClient: createCloudflareStoreClient(getModerationStoreStub(this.env)),
    discordApi: {
      deleteReaction: (channelId, messageId, emoji, userId) =>
        deleteReaction(channelId, messageId, emoji, userId, this.env.DISCORD_BOT_TOKEN),
    },
  });
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/reaction-moderation-service.test.js dist-tests/test/gateway-session.test.js`

Expected: PASS for the extracted moderation service and updated gateway-session coverage.

- [ ] **Step 5: Commit**

```bash
git add src/services/reaction-moderation-service.ts src/durable-objects/gateway-session.ts src/reaction-moderation.ts test/reaction-moderation-service.test.ts test/gateway-session.test.ts
git commit -m "refactor: delegate gateway moderation behavior"
```

### Task 6: Finish docs, clean remaining dead code, and run full verification

**Files:**
- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/runtime/app.ts`
- Modify: `src/runtime/cloudflare-runtime.ts`
- Modify: `test/runtime-app.test.ts`
- Modify: `test/admin-routes.test.ts`
- Modify: `test/interaction-routes.test.ts`
- Modify: `test/worker-tsconfig.test.ts`
- Test: `pnpm test`
- Test: `pnpm run typecheck`

- [ ] **Step 1: Write the failing regression checks**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp still serves admin shell, interactions, and gateway admin APIs after the Cloudflare-only cleanup", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    storeClient: { readConfig: async () => ({ guilds: {}, botUserId: "bot-user-id" }) } as never,
    gatewayClient: {
      status: async () => ({
        status: "idle",
        sessionId: null,
        resumeGatewayUrl: null,
        lastSequence: null,
        backoffAttempt: 0,
        lastError: null,
        heartbeatIntervalMs: null,
      }),
      start: async () => ({
        status: "connecting",
        sessionId: null,
        resumeGatewayUrl: null,
        lastSequence: null,
        backoffAttempt: 0,
        lastError: null,
        heartbeatIntervalMs: null,
      }),
    } as never,
    verifyDiscordRequest: async () => true,
  });

  const loginShell = await app.fetch(new Request("https://runtime.example/admin/login"));
  assert.equal(loginShell.status, 200);

  const cookie = await createAdminSessionCookie("session-secret");
  const gatewayStatus = await app.fetch(
    new Request("https://runtime.example/admin/api/gateway/status", {
      headers: { cookie },
    })
  );
  assert.equal(gatewayStatus.status, 200);

  const ping = await app.fetch(
    new Request("https://runtime.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "ignored-for-test",
        "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ type: 1 }),
    })
  );
  assert.deepEqual(await ping.json(), { type: 1 });
});
```

```txt
<!-- README.md -->
Add a final Cloudflare-only validation section:

## Local validation

pnpm test
pnpm run typecheck
pnpm exec wrangler deploy --dry-run
```

- [ ] **Step 2: Run targeted tests to verify they fail before the final cleanup**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js dist-tests/test/admin-routes.test.js dist-tests/test/interaction-routes.test.js`

Expected: FAIL until the last dead references to removed contracts, Node artifacts, or legacy routes are cleaned out.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/app.ts
// Final shape should only compose route handlers and shared context:

export function createRuntimeApp(context: RuntimeAppContext) {
  return {
    async fetch(request: Request): Promise<Response> {
      const publicResponse = await handlePublicRoutes(request, context);
      if (publicResponse) return publicResponse;

      const adminResponse = await handleAdminRoutes(request, context);
      if (adminResponse) return adminResponse;

      const interactionResponse = await handleInteractionRoutes(request, context);
      if (interactionResponse) return interactionResponse;

      return new Response("Not found", { status: 404 });
    },
  };
}
```

```txt
<!-- README.md -->
## Hosting model

This project deploys to Cloudflare Workers and Durable Objects only.

The Worker hosts:
- the public HTTP endpoints
- the authenticated admin UI
- the Discord interaction callback
- the scheduled gateway bootstrap

Durable Objects own:
- the Discord gateway session
- persistent automation state
- timed-role alarm execution
```

- [ ] **Step 4: Run the full verification suite**

Run: `pnpm test && pnpm run typecheck`

Expected: PASS with the Cloudflare-only test suite and typecheck; no Node runtime artifacts remain in the supported code path.

- [ ] **Step 5: Commit**

```bash
git add package.json README.md src/runtime/app.ts src/runtime/cloudflare-runtime.ts test/runtime-app.test.ts test/admin-routes.test.ts test/interaction-routes.test.ts test/worker-tsconfig.test.ts
git commit -m "refactor: finish cloudflare-only architecture cleanup"
```
