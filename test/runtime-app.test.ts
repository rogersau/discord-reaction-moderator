/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createRuntimeApp } from "../src/runtime/app";
import type { GatewayController, RuntimeStore } from "../src/runtime/contracts";

test("createRuntimeApp serves the admin login shell and static assets", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const loginResponse = await app.fetch(new Request("https://runtime.example/admin/login"));
  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await loginResponse.text(), /admin-root/);

  const assetResponse = await app.fetch(
    new Request("https://runtime.example/admin/assets/admin.js")
  );
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("content-type") ?? "", /javascript/);
});

test("createRuntimeApp handles health checks", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(new Request("https://runtime.example/health"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "OK");
});

test("createRuntimeApp handles Discord PING interactions", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(
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

  assert.deepEqual(await response.json(), { type: 1 });
});

test("createRuntimeApp handles /blocklist list command with empty guild", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
    } as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(
    new Request("https://runtime.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "ignored-for-test",
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

  assert.deepEqual(await response.json(), {
    type: 4,
    data: { flags: 64, content: "No emojis are blocked in this server." },
  });
});

test("createRuntimeApp respects enabled: false for /blocklist list", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return {
          guilds: {
            "guild-1": {
              enabled: false,
              emojis: ["🚫", "⛔"],
            },
          },
          botUserId: "bot-user-id",
        };
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(
    new Request("https://runtime.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "ignored-for-test",
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

  assert.deepEqual(await response.json(), {
    type: 4,
    data: { flags: 64, content: "No emojis are blocked in this server." },
  });
});

test("createRuntimeApp handles /admin/gateway/status via GET", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminAuthSecret: "admin-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {
      async status() {
        calls.push("status");
        return {
          status: "idle",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        };
      },
    } as GatewayController,
  });

  const response = await app.fetch(
    new Request("https://runtime.example/admin/gateway/status", {
      method: "GET",
      headers: { Authorization: "Bearer admin-secret" },
    })
  );

  assert.deepEqual(await response.json(), {
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

