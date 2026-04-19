/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createRuntimeApp, escapeHtmlAttribute } from "../src/runtime/app";
import { createAdminSessionCookie } from "../src/runtime/admin-auth";
import type { GatewayController, RuntimeStore } from "../src/runtime/contracts";
import type { AppConfigMutation } from "../src/runtime/admin-types";
import {
  buildTicketCloseCustomId,
  buildTicketOpenCustomId,
  buildTicketModalResponse,
} from "../src/tickets";
import type { TicketInstance, TicketPanelConfig, TimedRoleAssignment } from "../src/types";

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

test("createRuntimeApp rejects admin login when ADMIN_SESSION_SECRET is not configured", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    // adminSessionSecret deliberately not set - should reject login
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const loginResponse = await app.fetch(
    new Request("https://runtime.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
    })
  );

  assert.equal(loginResponse.status, 404, "Should reject login when session secret not configured");
});

test("createRuntimeApp serves authenticated dashboard shells for nested admin pages", async () => {
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
    new Request("https://runtime.example/admin/tickets", {
      headers: { cookie },
    })
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-authenticated="true"/);
  assert.match(html, /data-initial-path="\/admin\/tickets"/);
});

test("createRuntimeApp redirects unauthenticated nested admin pages to login", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(new Request("https://runtime.example/admin/gateway"));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login?next=%2Fadmin%2Fgateway");
});

test("createRuntimeApp redirects successful admin login back to the requested dashboard page", async () => {
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
    new Request("https://runtime.example/admin/login?next=%2Fadmin%2Ftickets", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
      redirect: "manual",
    })
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/tickets");
});

test("escapeHtmlAttribute escapes characters unsafe in HTML attributes", () => {
  assert.equal(
    escapeHtmlAttribute(`"/admin?<tag>&'`),
    "&quot;/admin?&lt;tag&gt;&amp;&#39;"
  );
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

test("createRuntimeApp returns 404 for legacy /admin/gateway/status endpoint", async () => {
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

  assert.equal(response.status, 404);
  assert.deepEqual(calls, []);
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

test("createRuntimeApp exposes dashboard overview data for discoverability in the admin UI", async () => {
  const originalFetch = globalThis.fetch;
  const VIEW_CHANNEL = 1n << 10n;
  const SEND_MESSAGES = 1n << 11n;
  const MANAGE_MESSAGES = 1n << 13n;
  const MANAGE_ROLES = 1n << 28n;
  const BOT_ROLE_PERMISSIONS = (VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES | MANAGE_ROLES).toString();
  const timedRoles: TimedRoleAssignment[] = [
    {
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 3_600_000,
    },
    {
      guildId: "guild-2",
      userId: "user-2",
      roleId: "role-2",
      durationInput: "2h",
      expiresAtMs: 7_200_000,
    },
  ];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/guilds/guild-1/channels")) {
      return Response.json([
        { id: "channel-1", name: "general", type: 0, parent_id: null, position: 0, permission_overwrites: [] },
        {
          id: "channel-2",
          name: "staff",
          type: 0,
          parent_id: null,
          position: 1,
          permission_overwrites: [{ id: "guild-1", type: 0, allow: "0", deny: MANAGE_MESSAGES.toString() }],
        },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/roles")) {
      return Response.json([
        { id: "guild-1", name: "@everyone", permissions: VIEW_CHANNEL.toString(), position: 0 },
        { id: "role-1", name: "Member", permissions: VIEW_CHANNEL.toString(), position: 2 },
        { id: "role-bot-1", name: "Bot", permissions: BOT_ROLE_PERMISSIONS, position: 5 },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/members/bot-user-id")) {
      return Response.json({ user: { id: "bot-user-id" }, roles: ["role-bot-1"] });
    }

    if (url.endsWith("/guilds/guild-2/channels")) {
      return Response.json([]);
    }

    if (url.endsWith("/guilds/guild-2/roles")) {
      return Response.json([
        { id: "guild-2", name: "@everyone", permissions: VIEW_CHANNEL.toString(), position: 0 },
        { id: "role-bot-2", name: "Bot", permissions: MANAGE_ROLES.toString(), position: 5 },
        { id: "role-2", name: "Senior", permissions: VIEW_CHANNEL.toString(), position: 6 },
      ]);
    }

    if (url.endsWith("/guilds/guild-2/members/bot-user-id")) {
      return Response.json({ user: { id: "bot-user-id" }, roles: ["role-bot-2"] });
    }

    if (url.endsWith("/guilds/guild-3/channels")) {
      return Response.json([
        { id: "channel-3", name: "general", type: 0, parent_id: null, position: 0, permission_overwrites: [] },
      ]);
    }

    if (url.endsWith("/guilds/guild-3/roles")) {
      return Response.json([
        { id: "guild-3", name: "@everyone", permissions: VIEW_CHANNEL.toString(), position: 0 },
        { id: "role-bot-3", name: "Bot", permissions: BOT_ROLE_PERMISSIONS, position: 5 },
      ]);
    }

    if (url.endsWith("/guilds/guild-3/members/bot-user-id")) {
      return Response.json({ user: { id: "bot-user-id" }, roles: ["role-bot-3"] });
    }

    throw new Error(`Unexpected Discord call: ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return {
            guilds: {
              "guild-1": { enabled: true, emojis: ["✅", "🍎"] },
              "guild-3": { enabled: true, emojis: ["🚫"] },
            },
            botUserId: "bot-user-id",
          };
        },
        async listTimedRoles() {
          return timedRoles;
        },
      } as unknown as RuntimeStore,
      gateway: {
        async status() {
          return {
            status: "ready",
            sessionId: "session-123",
            resumeGatewayUrl: "wss://resume.discord.gg/?v=10&encoding=json",
            lastSequence: 99,
            backoffAttempt: 0,
            lastError: null,
            heartbeatIntervalMs: 45_000,
          };
        },
      } as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const response = await app.fetch(
      new Request("https://runtime.example/admin/api/overview", {
        headers: { cookie },
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      gateway: {
        status: "ready",
        sessionId: "session-123",
        resumeGatewayUrl: "wss://resume.discord.gg/?v=10&encoding=json",
        lastSequence: 99,
        backoffAttempt: 0,
        lastError: null,
        heartbeatIntervalMs: 45_000,
      },
      guilds: [
        {
          guildId: "guild-1",
          emojis: ["✅", "🍎"],
          timedRoles: [
            {
              guildId: "guild-1",
              userId: "user-1",
              roleId: "role-1",
              durationInput: "1h",
              expiresAtMs: 3_600_000,
            },
          ],
          permissionChecks: [
            {
              label: "Manage Messages in text channels",
              status: "warning",
              detail: "Manage Messages is missing in 1 of 2 visible text channels, so reaction cleanup can fail there.",
            },
          ],
        },
        {
          guildId: "guild-2",
          emojis: [],
          timedRoles: [
            {
              guildId: "guild-2",
              userId: "user-2",
              roleId: "role-2",
              durationInput: "2h",
              expiresAtMs: 7_200_000,
            },
          ],
          permissionChecks: [
            {
              label: "Timed role targets below the bot",
              status: "error",
              detail: "1 tracked timed role is at or above the bot's highest role.",
            },
          ],
        },
        {
          guildId: "guild-3",
          emojis: ["🚫"],
          timedRoles: [],
          permissionChecks: [],
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp exposes the bot guild directory for the admin UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/users/@me/guilds")) {
      return Response.json([
        { id: "guild-2", name: "Alpha" },
        { id: "guild-3", name: "Alpha" },
        { id: "guild-1", name: "Bravo" },
      ]);
    }

    throw new Error(`Unexpected Discord call: ${url}`);
  }) as typeof fetch;

  try {
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
      new Request("https://runtime.example/admin/api/guilds", {
        headers: { cookie },
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      guilds: [
        { guildId: "guild-2", name: "Alpha", label: "Alpha (guild-2)" },
        { guildId: "guild-3", name: "Alpha", label: "Alpha (guild-3)" },
        { guildId: "guild-1", name: "Bravo", label: "Bravo" },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp exposes live blocklist permission diagnostics through session auth", async () => {
  const originalFetch = globalThis.fetch;
  const VIEW_CHANNEL = 1n << 10n;
  const SEND_MESSAGES = 1n << 11n;
  const MANAGE_MESSAGES = 1n << 13n;
  const BOT_ROLE_PERMISSIONS = (VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES).toString();

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/guilds/guild-1/channels")) {
      return Response.json([
        {
          id: "channel-1",
          name: "general",
          type: 0,
          parent_id: null,
          position: 0,
          permission_overwrites: [],
        },
        {
          id: "channel-2",
          name: "staff",
          type: 0,
          parent_id: null,
          position: 1,
          permission_overwrites: [
            {
              id: "guild-1",
              type: 0,
              allow: "0",
              deny: MANAGE_MESSAGES.toString(),
            },
          ],
        },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/roles")) {
      return Response.json([
        { id: "guild-1", name: "@everyone", permissions: VIEW_CHANNEL.toString(), position: 0 },
        { id: "role-bot", name: "Bot", permissions: BOT_ROLE_PERMISSIONS, position: 5 },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/members/bot-user-id")) {
      return Response.json({
        user: { id: "bot-user-id" },
        roles: ["role-bot"],
      });
    }

    throw new Error(`Unexpected Discord call: ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return { guilds: { "guild-1": { enabled: true, emojis: ["🚫"] } }, botUserId: "bot-user-id" };
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const response = await app.fetch(
      new Request("https://runtime.example/admin/api/permissions?guildId=guild-1&feature=blocklist", {
        headers: { cookie },
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      guildId: "guild-1",
      feature: "blocklist",
      checks: [
        {
          label: "Visible text channels",
          status: "ok",
          detail: "The bot can view 2 of 2 text channels in this server.",
        },
        {
          label: "Manage Messages in text channels",
          status: "warning",
          detail: "Manage Messages is missing in 1 of 2 visible text channels, so reaction cleanup can fail there.",
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp exposes timed-role admin APIs through session auth", async () => {
  const calls: string[] = [];
  const assignments: TimedRoleAssignment[] = [
    {
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 3_600_000,
    },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(`${init?.method ?? "GET"}:${url}`);
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
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
        async listTimedRolesByGuild(guildId: string) {
          return assignments.filter((assignment) => assignment.guildId === guildId);
        },
        async upsertTimedRole(body: TimedRoleAssignment) {
          assignments.push(body);
        },
        async deleteTimedRole(body: { guildId: string; userId: string; roleId: string }) {
          const index = assignments.findIndex(
            (assignment) =>
              assignment.guildId === body.guildId &&
              assignment.userId === body.userId &&
              assignment.roleId === body.roleId
          );
          if (index >= 0) {
            assignments.splice(index, 1);
          }
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");

    const listResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/timed-roles?guildId=guild-1", {
        headers: { cookie },
      })
    );
    assert.equal(listResponse.status, 200);
    assert.deepEqual(await listResponse.json(), { guildId: "guild-1", assignments });

    const addResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/timed-roles", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          guildId: "guild-1",
          userId: "user-2",
          roleId: "role-2",
          duration: "2h",
        }),
      })
    );
    assert.equal(addResponse.status, 200);

    const removeResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/timed-roles", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "remove",
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
        }),
      })
    );
    assert.equal(removeResponse.status, 200);
    assert.deepEqual(
      calls,
      [
        "PUT:https://discord.com/api/v10/guilds/guild-1/members/user-2/roles/role-2",
        "DELETE:https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
      ]
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp rejects malformed POST /admin/api/timed-roles bodies with 400 JSON", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls.push("discord");
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {
        async upsertTimedRole() {
          calls.push("store:add");
        },
        async deleteTimedRole() {
          calls.push("store:remove");
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const response = await app.fetch(
      new Request("https://runtime.example/admin/api/timed-roles", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
        }),
      })
    );

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Missing duration for timed role add" });
    assert.deepEqual(calls, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("createRuntimeApp exposes ticket admin APIs through session auth and publishes the panel message", async () => {
  const fetchCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  let storedPanel: TicketPanelConfig | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    }
    fetchCalls.push({ method, url, body });

    if (url.endsWith("/guilds/guild-1/channels")) {
      return Response.json([
        { id: "category-1", name: "Tickets", type: 4, parent_id: null, position: 1 },
        { id: "panel-channel", name: "ticket-panel", type: 0, parent_id: null, position: 2 },
        { id: "transcript-channel", name: "ticket-transcripts", type: 0, parent_id: null, position: 3 },
        { id: "text-1", name: "general", type: 0, parent_id: null, position: 4 },
        { id: "voice-1", name: "voice", type: 2, parent_id: null, position: 5 },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/roles")) {
      return Response.json([
        { id: "role-1", name: "Support", permissions: "0", position: 1 },
        { id: "role-2", name: "Helpers", permissions: "0", position: 2 },
      ]);
    }

    if (url.endsWith("/channels/panel-channel/messages") && method === "POST") {
      return Response.json({ id: "panel-message-1", channel_id: "panel-channel", content: "" });
    }

    if (url.endsWith("/channels/panel-channel/messages/panel-message-1") && method === "PATCH") {
      return Response.json({ id: "panel-message-1", channel_id: "panel-channel", content: "" });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {
        async readTicketPanelConfig(guildId: string) {
          return storedPanel?.guildId === guildId ? storedPanel : null;
        },
        async upsertTicketPanelConfig(panel: TicketPanelConfig) {
          storedPanel = panel;
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const invalidPanelResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ guildId: "guild-1" }),
      })
    );
    assert.equal(invalidPanelResponse.status, 400);
    assert.deepEqual(await invalidPanelResponse.json(), { error: "Missing panelChannelId" });

    const invalidPublishResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel/publish", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    assert.equal(invalidPublishResponse.status, 400);
    assert.deepEqual(await invalidPublishResponse.json(), { error: "Missing guildId" });

    const panel: TicketPanelConfig = createTicketPanelConfig();
    const invalidSupportRoleResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...panel,
          ticketTypes: [
            {
              ...panel.ticketTypes[0],
              supportRoleId: null,
            },
          ],
        }),
      })
    );
    assert.equal(invalidSupportRoleResponse.status, 400);
    assert.deepEqual(await invalidSupportRoleResponse.json(), {
      error: "Missing ticketTypes[0].supportRoleId",
    });
    const duplicateTicketTypeResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...panel,
          ticketTypes: [panel.ticketTypes[0], { ...panel.ticketTypes[0], label: "Appeal Copy" }],
        }),
      })
    );
    assert.equal(duplicateTicketTypeResponse.status, 400);
    assert.deepEqual(await duplicateTicketTypeResponse.json(), {
      error: "Duplicate ticketTypes[1].id",
    });
    const tooManyQuestionsResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          ...panel,
          ticketTypes: [
            {
              ...panel.ticketTypes[0],
              questions: Array.from({ length: 6 }, (_, index) => ({
                id: `question-${index + 1}`,
                label: `Question ${index + 1}`,
                style: "short",
                placeholder: null,
                required: true,
              })),
            },
          ],
        }),
      })
    );
    assert.equal(tooManyQuestionsResponse.status, 400);
    assert.deepEqual(await tooManyQuestionsResponse.json(), {
      error: "ticketTypes[0].questions cannot exceed 5 entries",
    });

    const saveResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify(panel),
      })
    );
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await saveResponse.json(), { ok: true, panel });

    const readResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel?guildId=guild-1", {
        headers: { cookie },
      })
    );
    assert.equal(readResponse.status, 200);
    assert.deepEqual(await readResponse.json(), { panel });

    const resourcesResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/resources?guildId=guild-1", {
        headers: { cookie },
      })
    );
    assert.equal(resourcesResponse.status, 200);
    assert.deepEqual(await resourcesResponse.json(), {
      guildId: "guild-1",
      roles: [
        { id: "role-1", name: "Support" },
        { id: "role-2", name: "Helpers" },
      ],
      categories: [{ id: "category-1", name: "Tickets" }],
      textChannels: [
        { id: "panel-channel", name: "ticket-panel" },
        { id: "transcript-channel", name: "ticket-transcripts" },
        { id: "text-1", name: "general" },
      ],
    });

    const publishResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel/publish", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ guildId: "guild-1" }),
      })
    );
    assert.equal(publishResponse.status, 200);
    assert.deepEqual(await publishResponse.json(), { ok: true, panelMessageId: "panel-message-1" });
    const savedPanel = storedPanel ?? panel;
    assert.equal(savedPanel.panelMessageId, "panel-message-1");

    const refreshResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel/publish", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ guildId: "guild-1" }),
      })
    );
    assert.equal(refreshResponse.status, 200);

    const publishCreate = fetchCalls.find(
      (call) => call.method === "POST" && call.url.endsWith("/channels/panel-channel/messages")
    );
    assert.deepEqual(publishCreate?.body, {
      content: "",
      embeds: [
        {
          color: 5763719,
          title: "Support tickets",
          description: "Use the button below to open a ticket.",
          footer: {
            text: "TicketTool.xyz - Ticketing without clutter",
          },
        },
      ],
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: buildTicketOpenCustomId("appeals"),
              label: "Appeal",
              style: 1,
              emoji: { name: "🧾" },
            },
          ],
        },
      ],
    });
    assert.ok(
      fetchCalls.some(
        (call) =>
          call.method === "PATCH" &&
          call.url.endsWith("/channels/panel-channel/messages/panel-message-1")
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp rejects ticket panel publish when referenced Discord targets are stale", async () => {
  const originalFetch = globalThis.fetch;
  let storedPanel: TicketPanelConfig | null = {
    ...createTicketPanelConfig(),
    panelChannelId: "missing-panel-channel",
    transcriptChannelId: "missing-transcript-channel",
    ticketTypes: [
      {
        ...createTicketPanelConfig().ticketTypes[0]!,
        supportRoleId: "missing-role",
      },
    ],
  };

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.endsWith("/guilds/guild-1/channels")) {
      return Response.json([
        { id: "category-1", name: "Tickets", type: 4, parent_id: null, position: 1 },
        { id: "panel-channel", name: "ticket-panel", type: 0, parent_id: null, position: 2 },
      ]);
    }

    if (url.endsWith("/guilds/guild-1/roles")) {
      return Response.json([{ id: "role-1", name: "Support", permissions: "0", position: 1 }]);
    }

    throw new Error(`Unexpected Discord call: ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {
        async readTicketPanelConfig(guildId: string) {
          return storedPanel?.guildId === guildId ? storedPanel : null;
        },
        async upsertTicketPanelConfig(panel: TicketPanelConfig) {
          storedPanel = panel;
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const publishResponse = await app.fetch(
      new Request("https://runtime.example/admin/api/tickets/panel/publish", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ guildId: "guild-1" }),
      })
    );
    assert.equal(publishResponse.status, 400);
    assert.deepEqual(await publishResponse.json(), {
      error:
        "Ticket panel config references missing Discord targets: panelChannelId missing-panel-channel, transcriptChannelId missing-transcript-channel, ticketTypes[0].supportRoleId missing-role",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp handles ticket open modal submit and close interactions", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const createdInstances: TicketInstance[] = [];
  const closeCalls: Array<{
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }> = [];
  const discordCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const openTickets = new Map<string, TicketInstance>();
  const panel = createTicketPanelConfig();

  Date.now = () => 1_700_000_000_000;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;

    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    } else if (init?.body instanceof FormData) {
      body = {
        payload_json: init.body.get("payload_json"),
        transcript: init.body.get("files[0]"),
      };
    }

    discordCalls.push({ method, url, body });

    if (url.endsWith("/guilds/guild-1/channels") && method === "POST") {
      return Response.json({ id: "ticket-channel-1" });
    }

    if (url.endsWith("/channels/ticket-channel-1/messages") && method === "POST") {
      return Response.json({ id: "opening-message-1", channel_id: "ticket-channel-1", content: "" });
    }

    if (url.endsWith("/channels/ticket-channel-1/messages?limit=100") && method === "GET") {
      return Response.json([
        {
          id: "message-2",
          channel_id: "ticket-channel-1",
          content: "Support reply",
          timestamp: "2024-01-01T00:00:01.000Z",
          author: {
            id: "staff-1",
            username: "mod",
            discriminator: "0002",
            global_name: "Support",
          },
        },
        {
          id: "message-1",
          channel_id: "ticket-channel-1",
          content: "Need help",
          timestamp: "2024-01-01T00:00:00.000Z",
          author: {
            id: "user-1",
            username: "alice",
            discriminator: "0001",
            global_name: "Alice",
          },
        },
      ]);
    }

    if (url.endsWith("/channels/transcript-channel/messages") && method === "POST") {
      return Response.json({ id: "transcript-message-1", channel_id: "transcript-channel", content: "" });
    }

    if (url.endsWith("/channels/ticket-channel-1") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return { guilds: {}, botUserId: "bot-user-id" };
        },
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async createTicketInstance(instance: TicketInstance) {
          createdInstances.push(instance);
          openTickets.set(`${instance.guildId}:${instance.channelId}`, instance);
        },
        async readOpenTicketByChannel(guildId: string, channelId: string) {
          return openTickets.get(`${guildId}:${channelId}`) ?? null;
        },
        async closeTicketInstance(body: {
          guildId: string;
          channelId: string;
          closedByUserId: string;
          closedAtMs: number;
          transcriptMessageId: string | null;
        }) {
          closeCalls.push(body);
          openTickets.delete(`${body.guildId}:${body.channelId}`);
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const openResponse = await app.fetch(
      createInteractionRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: { custom_id: buildTicketOpenCustomId("appeals") },
      })
    );
    assert.equal(openResponse.status, 200);
    assert.deepEqual(await openResponse.json(), buildTicketModalResponse(panel.ticketTypes[0]!));

    const submitResponse = await app.fetch(
      createInteractionRequest({
        type: 5,
        guild_id: "guild-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: {
          custom_id: buildTicketOpenCustomId("appeals"),
          components: [
            {
              type: 1,
              components: [{ type: 4, custom_id: "reason", value: "Need help" }],
            },
          ],
        },
      })
    );
    assert.equal(submitResponse.status, 200);
    assert.deepEqual(await submitResponse.json(), {
      type: 4,
      data: { flags: 64, content: "Created your ticket: <#ticket-channel-1>" },
    });
    assert.equal(createdInstances.length, 1);
    assert.deepEqual(createdInstances[0], {
      guildId: "guild-1",
      channelId: "ticket-channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "open",
      answers: [
        {
          questionId: "reason",
          label: "Why are you opening this ticket?",
          value: "Need help",
        },
      ],
      openedAtMs: 1_700_000_000_000,
      closedAtMs: null,
      closedByUserId: null,
      transcriptMessageId: null,
    });

    const openMessageCall = discordCalls.find(
      (call) => call.method === "POST" && call.url.endsWith("/channels/ticket-channel-1/messages")
    );
    assert.deepEqual(openMessageCall?.body, {
      content:
        "<@user-1> opened a new ticket.\nTicket Type: Appeal (appeals)\nOpened by: <@user-1>\nSubmitted Answers:\n- Why are you opening this ticket?: Need help",
      allowed_mentions: { users: ["user-1"] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: buildTicketCloseCustomId("ticket-channel-1"),
              label: "Close Ticket",
              style: 4,
            },
          ],
        },
      ],
    });

    const closeResponse = await app.fetch(
      createInteractionRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "ticket-channel-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: { custom_id: buildTicketCloseCustomId("ticket-channel-1") },
      })
    );
    assert.equal(closeResponse.status, 200);
    assert.deepEqual(await closeResponse.json(), {
      type: 4,
      data: { flags: 64, content: "Closed ticket and uploaded the transcript." },
    });
    assert.deepEqual(closeCalls, [
      {
        guildId: "guild-1",
        channelId: "ticket-channel-1",
        closedByUserId: "user-1",
        closedAtMs: 1_700_000_000_000,
        transcriptMessageId: "transcript-message-1",
      },
    ]);
    assert.ok(
      discordCalls.some(
        (call) => call.method === "DELETE" && call.url.endsWith("/channels/ticket-channel-1")
      )
    );

    const transcriptCall = discordCalls.find(
      (call) => call.method === "POST" && call.url.endsWith("/channels/transcript-channel/messages")
    );
    assert.equal(
      transcriptCall?.body && typeof transcriptCall.body === "object"
        ? (transcriptCall.body as { payload_json: FormDataEntryValue | null }).payload_json
        : null,
      JSON.stringify({ attachments: [{ id: 0, filename: "ticket-ticket-channel-1.txt" }] })
    );
    const transcriptFile = transcriptCall?.body && typeof transcriptCall.body === "object"
      ? ((transcriptCall.body as { transcript: FormDataEntryValue | null }).transcript as File | null)
      : null;
    assert.ok(transcriptFile instanceof File);
    assert.equal(await transcriptFile?.text(), `# Ticket Transcript
Guild: guild-1
Ticket Type: Appeal (appeals)
Channel: ticket-channel-1
Opened by: user-1
Support Role: role-1
Status: closed
Opened at: 2023-11-14T22:13:20.000Z
Closed at: 2023-11-14T22:13:20.000Z
Closed by: user-1

## Answers
- Why are you opening this ticket?: Need help

## Messages
[2024-01-01T00:00:00.000Z] Alice: Need help
[2024-01-01T00:00:01.000Z] Support: Support reply
`);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp creates a ticket immediately when the ticket type has no modal questions", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const createdInstances: TicketInstance[] = [];
  const discordCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const panel = {
    ...createTicketPanelConfig(),
    ticketTypes: [
      {
        ...createTicketPanelConfig().ticketTypes[0]!,
        questions: [],
      },
    ],
  };

  Date.now = () => 1_700_000_000_000;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    discordCalls.push({ method, url, body });

    if (url.endsWith("/guilds/guild-1/channels") && method === "POST") {
      return Response.json({ id: "ticket-channel-1", guild_id: "guild-1", name: "appeal-user-1" });
    }

    if (url.endsWith("/channels/ticket-channel-1/messages") && method === "POST") {
      return Response.json({ id: "message-1" });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return { guilds: {}, botUserId: "bot-user-id" };
        },
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async createTicketInstance(instance: TicketInstance) {
          createdInstances.push(instance);
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const response = await app.fetch(
      createInteractionRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: { custom_id: buildTicketOpenCustomId("appeals") },
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      type: 4,
      data: { flags: 64, content: "Created your ticket: <#ticket-channel-1>" },
    });
    assert.deepEqual(createdInstances, [
      {
        guildId: "guild-1",
        channelId: "ticket-channel-1",
        ticketTypeId: "appeals",
        ticketTypeLabel: "Appeal",
        openerUserId: "user-1",
        supportRoleId: "role-1",
        status: "open",
        answers: [],
        openedAtMs: 1_700_000_000_000,
        closedAtMs: null,
        closedByUserId: null,
        transcriptMessageId: null,
      },
    ]);

    const openMessageCall = discordCalls.find(
      (call) => call.method === "POST" && call.url.endsWith("/channels/ticket-channel-1/messages")
    );
    assert.deepEqual(openMessageCall?.body, {
      content:
        "<@user-1> opened a new ticket.\nTicket Type: Appeal (appeals)\nOpened by: <@user-1>\nSubmitted Answers:\n- No answers provided.",
      allowed_mentions: { users: ["user-1"] },
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: buildTicketCloseCustomId("ticket-channel-1"),
              label: "Close Ticket",
              style: 4,
            },
          ],
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
  }
});

test("createRuntimeApp rolls back ticket creation when the opening message fails", async () => {
  const originalFetch = globalThis.fetch;
  const createdInstances: TicketInstance[] = [];
  const deletedInstances: Array<{ guildId: string; channelId: string }> = [];
  const discordCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const panel = createTicketPanelConfig();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    discordCalls.push({ method, url, body });

    if (url.endsWith("/guilds/guild-1/channels") && method === "POST") {
      return Response.json({ id: "ticket-channel-1" });
    }

    if (url.endsWith("/channels/ticket-channel-1/messages") && method === "POST") {
      return new Response("boom", { status: 500 });
    }

    if (url.endsWith("/channels/ticket-channel-1") && method === "DELETE") {
      return new Response(null, { status: 204 });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return { guilds: {}, botUserId: "bot-user-id" };
        },
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async createTicketInstance(instance: TicketInstance) {
          createdInstances.push(instance);
        },
        async deleteTicketInstance(body: { guildId: string; channelId: string }) {
          deletedInstances.push(body);
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const submitResponse = await app.fetch(
      createInteractionRequest({
        type: 5,
        guild_id: "guild-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: {
          custom_id: buildTicketOpenCustomId("appeals"),
          components: [
            {
              type: 1,
              components: [{ type: 4, custom_id: "reason", value: "Need help" }],
            },
          ],
        },
      })
    );
    assert.equal(submitResponse.status, 200);
    assert.deepEqual(await submitResponse.json(), {
      type: 4,
      data: { flags: 64, content: "Failed to create your ticket." },
    });
    assert.equal(createdInstances.length, 1);
    assert.deepEqual(deletedInstances, [{ guildId: "guild-1", channelId: "ticket-channel-1" }]);
    assert.ok(
      discordCalls.some(
        (call) => call.method === "DELETE" && call.url.endsWith("/channels/ticket-channel-1")
      )
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp returns an ephemeral failure when ticket channel creation fails", async () => {
  const originalFetch = globalThis.fetch;
  let createTicketInstanceCalls = 0;
  const panel = createTicketPanelConfig();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    if (url.endsWith("/guilds/guild-1/channels") && method === "POST") {
      return new Response("boom", { status: 500 });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readConfig() {
          return { guilds: {}, botUserId: "bot-user-id" };
        },
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async createTicketInstance() {
          createTicketInstanceCalls += 1;
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const submitResponse = await app.fetch(
      createInteractionRequest({
        type: 5,
        guild_id: "guild-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: {
          custom_id: buildTicketOpenCustomId("appeals"),
          components: [
            {
              type: 1,
              components: [{ type: 4, custom_id: "reason", value: "Need help" }],
            },
          ],
        },
      })
    );
    assert.equal(submitResponse.status, 200);
    assert.deepEqual(await submitResponse.json(), {
      type: 4,
      data: { flags: 64, content: "Failed to create your ticket." },
    });
    assert.equal(createTicketInstanceCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp keeps the ticket open and posts an in-channel error when transcript upload fails", async () => {
  const originalFetch = globalThis.fetch;
  const closeCalls: Array<{
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }> = [];
  const discordCalls: Array<{ method: string; url: string; body: unknown }> = [];
  const panel = createTicketPanelConfig();
  const openTicket: TicketInstance = {
    guildId: "guild-1",
    channelId: "ticket-channel-1",
    ticketTypeId: "appeals",
    ticketTypeLabel: "Appeal",
    openerUserId: "user-1",
    supportRoleId: "role-1",
    status: "open",
    answers: [
      {
        questionId: "reason",
        label: "Why are you opening this ticket?",
        value: "Need help",
      },
    ],
    openedAtMs: 1_700_000_000_000,
    closedAtMs: null,
    closedByUserId: null,
    transcriptMessageId: null,
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    let body: unknown = null;

    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    } else if (init?.body instanceof FormData) {
      body = {
        payload_json: init.body.get("payload_json"),
        transcript: init.body.get("files[0]"),
      };
    }

    discordCalls.push({ method, url, body });

    if (url.endsWith("/channels/ticket-channel-1/messages?limit=100") && method === "GET") {
      return Response.json([
        {
          id: "message-1",
          channel_id: "ticket-channel-1",
          content: "Need help",
          timestamp: "2024-01-01T00:00:00.000Z",
          author: {
            id: "user-1",
            username: "alice",
            discriminator: "0001",
            global_name: "Alice",
          },
        },
      ]);
    }

    if (url.endsWith("/channels/transcript-channel/messages") && method === "POST") {
      return new Response("boom", { status: 500 });
    }

    if (url.endsWith("/channels/ticket-channel-1/messages") && method === "POST") {
      return Response.json({ id: "warning-message-1", channel_id: "ticket-channel-1", content: "" });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async readOpenTicketByChannel(guildId: string, channelId: string) {
          return guildId === "guild-1" && channelId === "ticket-channel-1" ? openTicket : null;
        },
        async closeTicketInstance(body: {
          guildId: string;
          channelId: string;
          closedByUserId: string;
          closedAtMs: number;
          transcriptMessageId: string | null;
        }) {
          closeCalls.push(body);
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const closeResponse = await app.fetch(
      createInteractionRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "ticket-channel-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: { custom_id: buildTicketCloseCustomId("ticket-channel-1") },
      })
    );
    assert.equal(closeResponse.status, 200);
    assert.deepEqual(await closeResponse.json(), {
      type: 4,
      data: {
        flags: 64,
        content:
          "Failed to upload the transcript. The ticket is still open, and a warning was posted in the channel.",
      },
    });
    assert.deepEqual(closeCalls, []);
    assert.ok(
      !discordCalls.some(
        (call) => call.method === "DELETE" && call.url.endsWith("/channels/ticket-channel-1")
      )
    );
    const warningCall =
      [...discordCalls]
        .reverse()
        .find((call) => call.method === "POST" && call.url.endsWith("/channels/ticket-channel-1/messages")) ??
      null;
    assert.deepEqual(warningCall?.body, {
      content:
        "Failed to upload the transcript for this ticket. The ticket will remain open so support staff can retry closing it.",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createRuntimeApp reports partial success when ticket close cleanup fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalDateNow = Date.now;
  const closeCalls: Array<{
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }> = [];
  const panel = createTicketPanelConfig();
  const openTicket: TicketInstance = {
    guildId: "guild-1",
    channelId: "ticket-channel-1",
    ticketTypeId: "appeals",
    ticketTypeLabel: "Appeal",
    openerUserId: "user-1",
    supportRoleId: "role-1",
    status: "open",
    answers: [],
    openedAtMs: 1_700_000_000_000,
    closedAtMs: null,
    closedByUserId: null,
    transcriptMessageId: null,
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";

    if (url.endsWith("/channels/ticket-channel-1/messages?limit=100") && method === "GET") {
      return Response.json([]);
    }

    if (url.endsWith("/channels/transcript-channel/messages") && method === "POST") {
      return Response.json({ id: "transcript-message-1", channel_id: "transcript-channel", content: "" });
    }

    if (url.endsWith("/channels/ticket-channel-1") && method === "DELETE") {
      return new Response("boom", { status: 500 });
    }

    throw new Error(`Unexpected Discord call: ${method} ${url}`);
  }) as typeof fetch;

  try {
    Date.now = () => 1_700_000_000_000;
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readTicketPanelConfig(guildId: string) {
          return guildId === "guild-1" ? panel : null;
        },
        async readOpenTicketByChannel(guildId: string, channelId: string) {
          return guildId === "guild-1" && channelId === "ticket-channel-1" ? openTicket : null;
        },
        async closeTicketInstance(body: {
          guildId: string;
          channelId: string;
          closedByUserId: string;
          closedAtMs: number;
          transcriptMessageId: string | null;
        }) {
          closeCalls.push(body);
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const closeResponse = await app.fetch(
      createInteractionRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "ticket-channel-1",
        member: { user: { id: "user-1" }, roles: [] },
        data: { custom_id: buildTicketCloseCustomId("ticket-channel-1") },
      })
    );
    assert.equal(closeResponse.status, 200);
    assert.deepEqual(await closeResponse.json(), {
      type: 4,
      data: {
        flags: 64,
        content:
          "Closed ticket and uploaded the transcript, but failed to delete the channel. Please clean it up manually.",
      },
    });
    assert.deepEqual(closeCalls, [
      {
        guildId: "guild-1",
        channelId: "ticket-channel-1",
        closedByUserId: "user-1",
        closedAtMs: 1_700_000_000_000,
        transcriptMessageId: "transcript-message-1",
      },
    ]);
  } finally {
    Date.now = originalDateNow;
    globalThis.fetch = originalFetch;
  }
});

function createInteractionRequest(body: unknown): Request {
  return new Request("https://runtime.example/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature-ed25519": "ignored-for-test",
      "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify(body),
  });
}

function createTicketPanelConfig(): TicketPanelConfig {
  return {
    guildId: "guild-1",
    panelChannelId: "panel-channel",
    categoryChannelId: "category-1",
    transcriptChannelId: "transcript-channel",
    panelTitle: "Support tickets",
    panelDescription: "Use the button below to open a ticket.",
    panelFooter: "TicketTool.xyz - Ticketing without clutter",
    panelMessageId: null,
    ticketTypes: [
      {
        id: "appeals",
        label: "Appeal",
        emoji: "🧾",
        buttonStyle: "primary",
        supportRoleId: "role-1",
        channelNamePrefix: "appeal",
        questions: [
          {
            id: "reason",
            label: "Why are you opening this ticket?",
            style: "paragraph",
            placeholder: "Explain the situation",
            required: true,
          },
        ],
      },
    ],
  };
}
