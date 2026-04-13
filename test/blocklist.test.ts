/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import {
  applyEmojiMutation,
  buildBlocklistConfig,
  getBlocklistFromStore,
  isEmojiBlocked,
  normalizeEmoji,
} from "../src/blocklist";
import { ModerationStoreDO } from "../src/durable-objects/moderation-store";
import worker from "../src/index";
import { DEFAULT_BLOCKLIST } from "../src/types";

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

test("buildBlocklistConfig materializes global and guild rules", () => {
  const config = buildBlocklistConfig(
    [{ normalized_emoji: "✅" }],
    [{ guild_id: "guild-disabled", moderation_enabled: 0 }],
    [{ guild_id: "guild-1", normalized_emoji: "❌" }],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  assert.equal(isEmojiBlocked("✅", config, "any-guild"), true);
  assert.equal(isEmojiBlocked("❌", config, "guild-1"), true);
  assert.equal(config.guilds["guild-disabled"]?.enabled, false);
  assert.equal(config.botUserId, "bot-1");
});

test("guild-specific blocklists stay isolated per guild", () => {
  const config = buildBlocklistConfig(
    [],
    [
      { guild_id: "guild-disabled", moderation_enabled: 0 },
      { guild_id: "guild-1", moderation_enabled: 1 },
    ],
    [
      { guild_id: "guild-disabled", normalized_emoji: "❌" },
      { guild_id: "guild-1", normalized_emoji: "✅" },
    ],
    []
  );

  assert.equal(isEmojiBlocked("✅", config, "guild-1"), true);
  assert.equal(isEmojiBlocked("❌", config, "guild-1"), false);
  assert.equal(isEmojiBlocked("❌", config, "guild-disabled"), false);
  assert.equal(isEmojiBlocked("✅", config, "guild-disabled"), false);
});

test("missing bot_user_id materializes as an empty string", () => {
  const config = buildBlocklistConfig([], [], [], []);

  assert.equal(config.botUserId, "");
});

test("applyEmojiMutation adds uniquely and removes exact matches", () => {
  const config = buildBlocklistConfig(
    [{ normalized_emoji: "✅" }],
    [],
    [],
    []
  );

  const added = applyEmojiMutation(config, {
    scope: "global",
    action: "add",
    emoji: "❌",
  });
  const removed = applyEmojiMutation(added, {
    scope: "global",
    action: "remove",
    emoji: "✅",
  });

  assert.deepEqual(added.emojis, ["✅", "❌"]);
  assert.deepEqual(removed.emojis, ["❌"]);
});

test("normalizeEmoji handles null and empty input", () => {
  assert.equal(normalizeEmoji(null), null);
  assert.equal(normalizeEmoji(""), null);
  assert.equal(normalizeEmoji(":blobcat:"), "blobcat");
});

test("getBlocklistFromStore reads the latest config from the moderation store", async () => {
  const expected = buildBlocklistConfig(
    [{ normalized_emoji: "✅" }],
    [{ guild_id: "guild-1", moderation_enabled: 1 }],
    [{ guild_id: "guild-1", normalized_emoji: "❌" }],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  const actual = await getBlocklistFromStore(() =>
    Promise.resolve(Response.json(expected))
  );

  assert.deepEqual(actual, expected);
});

test("ModerationStoreDO only seeds default emojis once", async () => {
  const sql = createFakeSql();
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;

  const store = new ModerationStoreDO(ctx, env);
  await store.fetch(
    new Request("https://moderation-store/emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emoji: DEFAULT_BLOCKLIST.emojis[0],
        action: "remove",
      }),
    })
  );

  const rehydratedStore = new ModerationStoreDO(ctx, env);
  const response = await rehydratedStore.fetch(
    new Request("https://moderation-store/config")
  );
  const config = (await response.json()) as { emojis: string[] };

  assert.equal(config.emojis.includes(DEFAULT_BLOCKLIST.emojis[0]), false);
});

test("ModerationStoreDO does not reseed deleted defaults for legacy stores", async () => {
  const sql = createFakeSql({
    appConfigEntries: [["bot_user_id", "bot-1"]],
    globalBlockedEmojis: DEFAULT_BLOCKLIST.emojis.slice(1),
  });
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;

  const store = new ModerationStoreDO(ctx, env);
  const response = await store.fetch(new Request("https://moderation-store/config"));
  const config = (await response.json()) as { emojis: string[] };

  assert.equal(config.emojis.includes(DEFAULT_BLOCKLIST.emojis[0]), false);
});

test("ModerationStoreDO seeds bot user id from env only when missing", async () => {
  const ctx = {
    storage: { sql: createFakeSql() },
  } as unknown as DurableObjectState;
  const store = new ModerationStoreDO(ctx, { BOT_USER_ID: "seeded-bot-id" } as never);
  const response = await store.fetch(new Request("https://moderation-store/config"));
  const config = (await response.json()) as { botUserId: string };

  assert.equal(config.botUserId, "seeded-bot-id");
});

test("ModerationStoreDO seeds bot user id from env for existing stores when missing", async () => {
  const ctx = {
    storage: {
      sql: createFakeSql({
        globalBlockedEmojis: [DEFAULT_BLOCKLIST.emojis[0]],
      }),
    },
  } as unknown as DurableObjectState;
  const store = new ModerationStoreDO(ctx, { BOT_USER_ID: "seeded-bot-id" } as never);
  const response = await store.fetch(new Request("https://moderation-store/config"));
  const config = (await response.json()) as { botUserId: string };

  assert.equal(config.botUserId, "seeded-bot-id");
});

test("ModerationStoreDO preserves stored bot user id across reconstruction", async () => {
  const ctx = {
    storage: { sql: createFakeSql() },
  } as unknown as DurableObjectState;
  const store = new ModerationStoreDO(ctx, { BOT_USER_ID: "env-bot-id" } as never);

  const writeResponse = await store.fetch(
    new Request("https://moderation-store/app-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bot_user_id", value: "stored-bot-id" }),
    })
  );
  assert.equal(writeResponse.status, 200);

  const rehydratedStore = new ModerationStoreDO(
    ctx,
    { BOT_USER_ID: "fresh-env-bot-id" } as never
  );
  const response = await rehydratedStore.fetch(
    new Request("https://moderation-store/config")
  );
  const config = (await response.json()) as { botUserId: string };

  assert.equal(config.botUserId, "stored-bot-id");
});

test("ModerationStoreDO maps invalid input to 400 and storage faults to 500", async () => {
  const ctx = {
    storage: { sql: createFakeSql() },
  } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const invalidJsonResponse = await store.fetch(
    new Request("https://moderation-store/emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
  );
  const invalidInputResponse = await store.fetch(
    new Request("https://moderation-store/emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove" }),
    })
  );

  const failingStore = new ModerationStoreDO(
    {
      storage: { sql: createFakeSql({ failOnDelete: true }) },
    } as unknown as DurableObjectState,
    env
  );
  const originalConsoleError = console.error;
  let storageFailureResponse: Response;

  console.error = () => {};
  try {
    storageFailureResponse = await failingStore.fetch(
      new Request("https://moderation-store/emoji", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emoji: DEFAULT_BLOCKLIST.emojis[0],
          action: "remove",
        }),
      })
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(invalidJsonResponse.status, 400);
  assert.equal(invalidInputResponse.status, 400);
  assert.equal(storageFailureResponse.status, 500);
});

test("ModerationStoreDO rejects empty app-config keys with 400", async () => {
  const ctx = {
    storage: { sql: createFakeSql() },
  } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const response = await store.fetch(
    new Request("https://moderation-store/app-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "", value: "bot-2" }),
    })
  );

  assert.equal(response.status, 400);
});

test("ModerationStoreDO returns 500 when config reads hit storage faults", async () => {
  const ctx = {
    storage: { sql: createFakeSql({ failOnSelectConfig: true }) },
  } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const originalConsoleError = console.error;
  let response: Response;

  console.error = () => {};
  try {
    response = await store.fetch(new Request("https://moderation-store/config"));
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(response.status, 500);
});

test("worker uses moderation store config for live moderation decisions", async () => {
  const timestamp = "1700000000";
  const payload = {
    t: "MESSAGE_REACTION_ADD",
    s: 1,
    op: 0,
    d: {
      channel_id: "channel-1",
      message_id: "message-1",
      guild_id: "guild-1",
      emoji: { id: null, name: "✅", animated: false },
      user_id: "user-1",
    },
  };
  const body = JSON.stringify(payload);
  const signedRequest = await signDiscordRequest(body, timestamp);
  const storeFetches: string[] = [];
  const deleteCalls: Array<{ input: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  globalThis.fetch = async (input, init) => {
    deleteCalls.push({
      input: String(input),
      method: init?.method,
    });
    return new Response(null, { status: 204 });
  };
  console.log = () => {};

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          "x-signature-ed25519": signedRequest.signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
      {
        DISCORD_BOT_TOKEN: "bot-token",
        DISCORD_PUBLIC_KEY: signedRequest.publicKey,
        BOT_USER_ID: "bot-1",
        GATEWAY_SESSION_DO: {
          idFromName() {
            return "gateway-id" as never;
          },
          get() {
            return {
              fetch: async () => Response.json({ status: "idle" }),
            };
          },
        } as never,
        MODERATION_STORE_DO: {
          idFromName() {
            return "store-id" as never;
          },
          get() {
            return {
              fetch: async (input: Request | string | URL) => {
                storeFetches.push(String(input));
                return Response.json({
                  emojis: ["✅"],
                  guilds: {},
                  botUserId: "bot-1",
                });
              },
            };
          },
        } as never,
      },
      {} as ExecutionContext
    );

    assert.equal(response.status, 200);
    assert.deepEqual(storeFetches, ["https://moderation-store/config"]);
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0]?.method, "DELETE");
    assert.match(deleteCalls[0]?.input ?? "", /\/reactions\/%E2%9C%85\/user-1$/);
  } finally {
    console.log = originalConsoleLog;
    globalThis.fetch = originalFetch;
  }
});

test("worker still acknowledges webhook when moderation store config fails", async () => {
  const timestamp = "1700000001";
  const payload = {
    t: "MESSAGE_REACTION_ADD",
    s: 1,
    op: 0,
    d: {
      channel_id: "channel-1",
      message_id: "message-1",
      guild_id: "guild-1",
      emoji: { id: null, name: "✅", animated: false },
      user_id: "user-1",
    },
  };
  const body = JSON.stringify(payload);
  const signedRequest = await signDiscordRequest(body, timestamp);
  const deleteCalls: Array<{ input: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;

  globalThis.fetch = async (input, init) => {
    deleteCalls.push({
      input: String(input),
      method: init?.method,
    });
    return new Response(null, { status: 204 });
  };
  console.error = () => {};

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          "x-signature-ed25519": signedRequest.signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
      {
        DISCORD_BOT_TOKEN: "bot-token",
        DISCORD_PUBLIC_KEY: signedRequest.publicKey,
        BOT_USER_ID: "bot-1",
        GATEWAY_SESSION_DO: {
          idFromName() {
            return "gateway-id" as never;
          },
          get() {
            return {
              fetch: async () => Response.json({ status: "idle" }),
            };
          },
        } as never,
        MODERATION_STORE_DO: {
          idFromName() {
            return "store-id" as never;
          },
          get() {
            return {
              fetch: async () =>
                Response.json({ error: "boom" }, { status: 500 }),
            };
          },
        } as never,
      },
      {} as ExecutionContext
    );

    assert.equal(response.status, 200);
    assert.equal(deleteCalls.length, 0);
  } finally {
    console.error = originalConsoleError;
    globalThis.fetch = originalFetch;
  }
});

test("worker ignores bot reactions using the moderation store bot user id", async () => {
  const timestamp = "1700000002";
  const payload = {
    t: "MESSAGE_REACTION_ADD",
    s: 1,
    op: 0,
    d: {
      channel_id: "channel-1",
      message_id: "message-1",
      guild_id: "guild-1",
      emoji: { id: null, name: "✅", animated: false },
      user_id: "bot-from-store",
    },
  };
  const body = JSON.stringify(payload);
  const signedRequest = await signDiscordRequest(body, timestamp);
  const deleteCalls: Array<{ input: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    deleteCalls.push({
      input: String(input),
      method: init?.method,
    });
    return new Response(null, { status: 204 });
  };

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          "x-signature-ed25519": signedRequest.signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
      {
        DISCORD_BOT_TOKEN: "bot-token",
        DISCORD_PUBLIC_KEY: signedRequest.publicKey,
        BOT_USER_ID: "env-bot-id",
        GATEWAY_SESSION_DO: {
          idFromName() {
            return "gateway-id" as never;
          },
          get() {
            return {
              fetch: async () => Response.json({ status: "idle" }),
            };
          },
        } as never,
        MODERATION_STORE_DO: {
          idFromName() {
            return "store-id" as never;
          },
          get() {
            return {
              fetch: async () =>
                Response.json({
                  emojis: ["✅"],
                  guilds: {},
                  botUserId: "bot-from-store",
                }),
            };
          },
        } as never,
      },
      {} as ExecutionContext
    );

    assert.equal(response.status, 200);
    assert.equal(deleteCalls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker does not fall back to env bot user id when store bot user id is empty", async () => {
  const timestamp = "1700000003";
  const payload = {
    t: "MESSAGE_REACTION_ADD",
    s: 1,
    op: 0,
    d: {
      channel_id: "channel-1",
      message_id: "message-1",
      guild_id: "guild-1",
      emoji: { id: null, name: "✅", animated: false },
      user_id: "env-bot-id",
    },
  };
  const body = JSON.stringify(payload);
  const signedRequest = await signDiscordRequest(body, timestamp);
  const deleteCalls: Array<{ input: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  globalThis.fetch = async (input, init) => {
    deleteCalls.push({
      input: String(input),
      method: init?.method,
    });
    return new Response(null, { status: 204 });
  };
  console.log = () => {};

  try {
    const response = await worker.fetch(
      new Request("https://worker.example", {
        method: "POST",
        headers: {
          "x-signature-ed25519": signedRequest.signature,
          "x-signature-timestamp": timestamp,
        },
        body,
      }),
      {
        DISCORD_BOT_TOKEN: "bot-token",
        DISCORD_PUBLIC_KEY: signedRequest.publicKey,
        BOT_USER_ID: "env-bot-id",
        GATEWAY_SESSION_DO: {
          idFromName() {
            return "gateway-id" as never;
          },
          get() {
            return {
              fetch: async () => Response.json({ status: "idle" }),
            };
          },
        } as never,
        MODERATION_STORE_DO: {
          idFromName() {
            return "store-id" as never;
          },
          get() {
            return {
              fetch: async () =>
                Response.json({
                  emojis: ["✅"],
                  guilds: {},
                  botUserId: "",
                }),
            };
          },
        } as never,
      },
      {} as ExecutionContext
    );

    assert.equal(response.status, 200);
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0]?.method, "DELETE");
    assert.match(deleteCalls[0]?.input ?? "", /\/reactions\/%E2%9C%85\/env-bot-id$/);
  } finally {
    console.log = originalConsoleLog;
    globalThis.fetch = originalFetch;
  }
});

function createFakeSql(options?: {
  failOnDelete?: boolean;
  failOnSelectConfig?: boolean;
  globalBlockedEmojis?: string[];
  appConfigEntries?: Array<[string, string]>;
}) {
  const globalBlockedEmojis = new Set<string>(options?.globalBlockedEmojis ?? []);
  const appConfig = new Map<string, string>(options?.appConfigEntries ?? []);

  return {
    exec(query: string, ...params: unknown[]) {
      if (query.includes("CREATE TABLE IF NOT EXISTS")) {
        return [];
      }

      if (
        query === "INSERT OR IGNORE INTO global_blocked_emojis(normalized_emoji) VALUES(?)"
      ) {
        globalBlockedEmojis.add(params[0] as string);
        return [];
      }

      if (
        query ===
        "DELETE FROM global_blocked_emojis WHERE normalized_emoji = ?"
      ) {
        if (options?.failOnDelete) {
          throw new Error("storage fault");
        }

        globalBlockedEmojis.delete(params[0] as string);
        return [];
      }

      if (
        query === "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)"
      ) {
        const [key, value] = params as [string, string];
        if (!appConfig.has(key)) {
          appConfig.set(key, value);
        }
        return [];
      }

      if (query === "SELECT key FROM app_config WHERE key = ?") {
        const value = appConfig.get(params[0] as string);
        return value === undefined ? [] : [{ key: params[0] as string }];
      }

      if (
        query ===
        "INSERT INTO app_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ) {
        appConfig.set(params[0] as string, params[1] as string);
        return [];
      }

      if (query === "SELECT normalized_emoji FROM global_blocked_emojis") {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        return [...globalBlockedEmojis].map((normalized_emoji) => ({
          normalized_emoji,
        }));
      }

      if (
        query === "SELECT guild_id, moderation_enabled FROM guild_settings" ||
        query === "SELECT guild_id, normalized_emoji FROM guild_blocked_emojis"
      ) {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        return [];
      }

      if (query === "SELECT 1 FROM global_blocked_emojis LIMIT 1") {
        return globalBlockedEmojis.size > 0 ? [{ 1: 1 }] : [];
      }

      if (
        query === "SELECT 1 FROM guild_settings LIMIT 1" ||
        query === "SELECT 1 FROM guild_blocked_emojis LIMIT 1"
      ) {
        return [];
      }

      if (query === "SELECT 1 FROM app_config LIMIT 1") {
        return appConfig.size > 0 ? [{ 1: 1 }] : [];
      }

      if (query === "SELECT key, value FROM app_config") {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        return [...appConfig.entries()].map(([key, value]) => ({ key, value }));
      }

      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
}

async function signDiscordRequest(body: string, timestamp: string) {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const payload = new TextEncoder().encode(timestamp + body);
  const signature = await crypto.subtle.sign("Ed25519", keyPair.privateKey, payload);
  const publicKey = (await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey
  )) as ArrayBuffer;

  return {
    signature: bytesToHex(new Uint8Array(signature)),
    publicKey: bytesToHex(new Uint8Array(publicKey)),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
