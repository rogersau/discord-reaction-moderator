/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import { SLASH_COMMAND_DEFINITIONS } from "../src/discord-commands";
import worker from "../src/index";

test("worker no longer exposes the legacy /admin/blocklist route", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/admin/blocklist"),
    createEnv(),
    {} as ExecutionContext
  );

  assert.equal(response.status, 404);
});

test("worker proxies /admin/gateway/status to the gateway session durable object", async () => {
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

  assert.equal(response.status, 200);
  assert.deepEqual(gatewayFetches, ["https://gateway-session/status"]);
  assert.deepEqual(await response.json(), { status: "idle" });
});

test("worker proxies /admin/gateway/start to the gateway session durable object", async () => {
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

  assert.equal(response.status, 200);
  assert.deepEqual(gatewayFetches, [
    {
      input: "https://gateway-session/start",
      method: "POST",
    },
  ]);
  assert.deepEqual(await response.json(), { status: "connecting" });
});

test("worker protects gateway admin routes with ADMIN_AUTH_SECRET", async () => {
  let gatewayCalls = 0;

  const response = await worker.fetch(
    new Request("https://worker.example/admin/gateway/status"),
    createEnv({
      ADMIN_AUTH_SECRET: "top-secret",
      gatewayFetch() {
        gatewayCalls += 1;
        return Response.json({ status: "idle" });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
  assert.equal(gatewayCalls, 0);
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

function createEnv(options?: {
  ADMIN_AUTH_SECRET?: string;
  DISCORD_APPLICATION_ID?: string;
  gatewayFetch?: (input: Request | string | URL, init?: RequestInit) => Response;
}) {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: options?.DISCORD_APPLICATION_ID,
    ADMIN_AUTH_SECRET: options?.ADMIN_AUTH_SECRET,
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
