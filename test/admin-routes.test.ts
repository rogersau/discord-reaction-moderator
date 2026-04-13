/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import worker from "../src/index";

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

function createEnv(options?: {
  ADMIN_AUTH_SECRET?: string;
  gatewayFetch?: (input: Request | string | URL, init?: RequestInit) => Response;
}) {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_PUBLIC_KEY: "public-key",
    BOT_USER_ID: "bot-user-id",
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
