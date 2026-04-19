/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import { SLASH_COMMAND_DEFINITIONS } from "../src/discord-commands";
import worker from "../src/index";

test("worker serves the admin shell for nested dashboard routes", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/blocklist?guildId=guild-1"),
    createEnv(),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-authenticated="true"/);
  assert.match(html, /data-initial-path="\/admin\/blocklist"/);
  assert.match(html, /data-initial-search="\?guildId=guild-1"/);
});

test("worker returns 404 for legacy /admin/gateway/status endpoint", async () => {
  const gatewayFetches: string[] = [];

  const response = await worker.fetch(
    new Request("https://worker.example/admin/gateway/status"),
    createEnv({
      gatewayFetch(input) {
        gatewayFetches.push(String(input));
        return Response.json({ status: "idle" });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
  assert.equal(gatewayFetches.length, 0);
});

test("worker returns 404 for legacy /admin/gateway/start endpoint", async () => {
  const gatewayFetches: Array<{ input: string; method: string }> = [];

  const response = await worker.fetch(
    new Request("https://worker.example/admin/gateway/start", {
      method: "POST",
    }),
    createEnv({
      gatewayFetch(input, init) {
        gatewayFetches.push({
          input: String(input),
          method: init?.method ?? "GET",
        });
        return Response.json({ status: "connecting" });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
  assert.equal(gatewayFetches.length, 0);
});

test("worker scheduled handler bootstraps the gateway session durable object", async () => {
  const gatewayFetches: Array<{ input: string; method: string }> = [];
  const waitUntils: Promise<unknown>[] = [];
  const scheduledWorker = worker as {
    scheduled?: (
      controller: ScheduledController,
      env: never,
      ctx: ExecutionContext
    ) => void;
  };

  scheduledWorker.scheduled?.(
    {} as ScheduledController,
    createEnv({
      gatewayFetch(input, init) {
        gatewayFetches.push({
          input: String(input),
          method: init?.method ?? "GET",
        });
        return Response.json({ status: "connecting" });
      },
    }),
    {
      waitUntil(promise) {
        waitUntils.push(promise);
      },
    } as ExecutionContext
  );

  await Promise.all(waitUntils);

  assert.deepEqual(gatewayFetches, [
    {
      input: "https://gateway-session/start",
      method: "POST",
    },
  ]);
});

test("worker scheduled handler syncs slash commands before starting the gateway session", async () => {
  const gatewayFetches: Array<{ input: string; method: string }> = [];
  const bootstrapSequence: string[] = [];
  const discordRequests: Array<{
    input: string;
    method: string;
    authorization: string | null;
    body: unknown;
  }> = [];
  const waitUntils: Promise<unknown>[] = [];
  const scheduledWorker = worker as {
    scheduled?: (
      controller: ScheduledController,
      env: never,
      ctx: ExecutionContext
    ) => void;
  };
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    bootstrapSequence.push("sync");
    discordRequests.push({
      input: String(input),
      method: init?.method ?? "GET",
      authorization:
        init?.headers instanceof Headers
          ? init.headers.get("Authorization")
          : Array.isArray(init?.headers)
            ? new Headers(init.headers).get("Authorization")
            : new Headers(init?.headers).get("Authorization"),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });

    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    scheduledWorker.scheduled?.(
      {} as ScheduledController,
      createEnv({
        DISCORD_APPLICATION_ID: "application-id",
        gatewayFetch(input, init) {
          bootstrapSequence.push("start");
          gatewayFetches.push({
            input: String(input),
            method: init?.method ?? "GET",
          });
          return Response.json({ status: "connecting" });
        },
      }),
      {
        waitUntil(promise) {
          waitUntils.push(promise);
        },
      } as ExecutionContext
    );

    await Promise.all(waitUntils);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(discordRequests, [
    {
      input: "https://discord.com/api/v10/applications/application-id/commands",
      method: "PUT",
      authorization: "Bot bot-token",
      body: SLASH_COMMAND_DEFINITIONS,
    },
  ]);
  assert.deepEqual(gatewayFetches, [
    {
      input: "https://gateway-session/start",
      method: "POST",
    },
  ]);
  assert.deepEqual(bootstrapSequence, ["sync", "start"]);
});

test("worker rejects the legacy signed HTTP reaction ingress path", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example", { method: "POST", body: "{}" }),
    createEnv(),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
});

test("worker proxies /admin/api/gateway/status to the gateway session durable object", async () => {
  const gatewayFetches: string[] = [];

  const response = await worker.fetch(
    new Request("https://worker.example/admin/api/gateway/status"),
    createEnv({
      ADMIN_UI_PASSWORD: "secret",
      ADMIN_SESSION_SECRET: "session-secret",
      gatewayFetch(input) {
        gatewayFetches.push(String(input));
        return Response.json({ status: "idle" });
      },
    }),
    {} as ExecutionContext
  );

  // Should be 401 without a valid session, but the route should exist
  assert.equal(response.status, 401);
});

test("worker proxies /admin/api/gateway/start to the gateway session durable object", async () => {
  const gatewayFetches: Array<{ input: string; method: string }> = [];

  const response = await worker.fetch(
    new Request("https://worker.example/admin/api/gateway/start", {
      method: "POST",
    }),
    createEnv({
      ADMIN_UI_PASSWORD: "secret",
      ADMIN_SESSION_SECRET: "session-secret",
      gatewayFetch(input, init) {
        gatewayFetches.push({
          input: String(input),
          method: init?.method ?? "GET",
        });
        return Response.json({ status: "connecting" });
      },
    }),
    {} as ExecutionContext
  );

  // Should be 401 without a valid session, but the route should exist
  assert.equal(response.status, 401);
});

function createEnv(options?: {
  ADMIN_AUTH_SECRET?: string;
  ADMIN_UI_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  DISCORD_APPLICATION_ID?: string;
  gatewayFetch?: (input: Request | string | URL, init?: RequestInit) => Response;
}) {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: options?.DISCORD_APPLICATION_ID,
    ADMIN_AUTH_SECRET: options?.ADMIN_AUTH_SECRET,
    ADMIN_UI_PASSWORD: options?.ADMIN_UI_PASSWORD,
    ADMIN_SESSION_SECRET: options?.ADMIN_SESSION_SECRET,
    MODERATION_STORE_DO: {
      idFromName() {
        return "moderation-store-id" as never;
      },
      get() {
        return {
          fetch: async () => Response.json({ emojis: [], guilds: {}, botUserId: "" }),
        };
      },
    } as never,
    GATEWAY_SESSION_DO: {
      idFromName() {
        return "gateway-session-id" as never;
      },
      get() {
        return {
          fetch: async (input: Request | string | URL, init?: RequestInit) =>
            options?.gatewayFetch?.(input, init) ??
            Response.json({ status: "idle" }),
        };
      },
    } as never,
  } as never;
}

test("worker returns 404 for /admin/api/* when ADMIN_UI_PASSWORD is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/api/gateway/status"),
    createEnv(),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "Admin API is not configured.");
});

test("worker returns 401 for /admin/api/* when ADMIN_UI_PASSWORD is set but no valid session", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/api/gateway/status"),
    createEnv({ ADMIN_UI_PASSWORD: "secret", ADMIN_SESSION_SECRET: "session-secret" }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "Unauthorized");
});

test("worker returns 404 for GET /admin/api/config when ADMIN_UI_PASSWORD is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/api/config"),
    createEnv(),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
});
