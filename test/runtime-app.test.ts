/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createRuntimeApp } from "../src/runtime/app";
import { createAdminSessionCookie } from "../src/runtime/admin-auth";
import type { GatewayController, RuntimeStore } from "../src/runtime/contracts";
import type { AppConfigMutation } from "../src/runtime/admin-types";

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

test("createRuntimeApp redirects unauthenticated admin requests and sets a session cookie on login", async () => {
  const configWrites: Array<{ key: string; value: string }> = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
      async upsertAppConfig(body: { key: string; value: string }) {
        configWrites.push(body);
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const unauthenticated = await app.fetch(new Request("https://runtime.example/admin"));
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.get("location"), "/admin/login");

  const loginResponse = await app.fetch(
    new Request("https://runtime.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
    })
  );

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.get("location"), "/admin");
  assert.match(loginResponse.headers.get("set-cookie") ?? "", /admin_session=/);
  assert.deepEqual(configWrites, []);
});

test("createRuntimeApp rejects invalid admin login passwords", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
      async upsertAppConfig() {},
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const loginResponse = await app.fetch(
    new Request("https://runtime.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=wrong-password",
    })
  );

  assert.equal(loginResponse.status, 401);
  assert.equal(loginResponse.headers.get("set-cookie"), null);
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

test("createRuntimeApp returns dashboard data and blocklist mutations through session-protected admin APIs", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: { "guild-1": { enabled: true, emojis: ["✅"] } }, botUserId: "bot-user-id" };
      },
      async upsertAppConfig(body: AppConfigMutation) {
        calls.push(`config:${body.key}:${body.value}`);
      },
      async applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }) {
        calls.push(`blocklist:${body.guildId}:${body.emoji}:${body.action}`);
        return { guilds: { [body.guildId]: { enabled: true, emojis: body.action === "add" ? ["✅", body.emoji] : ["✅"] } }, botUserId: "bot-user-id" };
      },
    } as unknown as RuntimeStore,
    gateway: {
      async status() {
        return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
      async start() {
        calls.push("gateway:start");
        return { status: "connecting", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
    },
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const statusResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/gateway/status", {
      headers: { cookie },
    })
  );
  assert.equal(statusResponse.status, 200);

  const configResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/config", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ key: "bot_user_id", value: "new-bot-id" }),
    })
  );
  assert.equal(configResponse.status, 200);

  const blocklistResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/blocklist", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", emoji: "🚫", action: "add" }),
    })
  );
  assert.equal(blocklistResponse.status, 200);
  assert.deepEqual(calls, ["config:bot_user_id:new-bot-id", "blocklist:guild-1:🚫:add"]);
});

test("createRuntimeApp rejects malformed POST /admin/api/config bodies with 400 JSON", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async upsertAppConfig() {
        calls.push("config");
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const response = await app.fetch(
    new Request("https://runtime.example/admin/api/config", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ key: "bot_user_id" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Missing app config key or value" });
  assert.deepEqual(calls, []);
});

test("createRuntimeApp rejects malformed POST /admin/api/blocklist bodies with 400 JSON", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async applyGuildEmojiMutation() {
        calls.push("blocklist");
        return { guilds: {}, botUserId: "bot-user-id" };
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const response = await app.fetch(
    new Request("https://runtime.example/admin/api/blocklist", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", emoji: "🚫", action: "block" }),
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid action. Use 'add' or 'remove'" });
  assert.deepEqual(calls, []);
});

test("createRuntimeApp rejects unauthenticated /admin/api/* requests with 401 JSON", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(
    new Request("https://runtime.example/admin/api/gateway/status")
  );
  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.equal(body.error, "Unauthorized");
});

test("createRuntimeApp serves admin shell with data-authenticated for authenticated /admin GET", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const response = await app.fetch(
    new Request("https://runtime.example/admin", { headers: { cookie } })
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /data-authenticated="true"/);
});

test("createRuntimeApp GET /admin/api/config returns current config under session auth", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return {
          guilds: { "guild-1": { enabled: true, emojis: ["✅"] } },
          botUserId: "bot-user-id",
        };
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const response = await app.fetch(
    new Request("https://runtime.example/admin/api/config", { headers: { cookie } })
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { botUserId: string };
  assert.equal(body.botUserId, "bot-user-id");
});
