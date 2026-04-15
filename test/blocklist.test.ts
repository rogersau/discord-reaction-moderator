/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import {
  buildBlocklistConfig,
  getBlocklistFromStore,
  isEmojiBlocked,
  normalizeEmoji,
} from "../src/blocklist";
import { ModerationStoreDO } from "../src/durable-objects/moderation-store";

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

test("buildBlocklistConfig materializes guild rules", () => {
  const config = buildBlocklistConfig(
    [{ guild_id: "guild-disabled", moderation_enabled: 0 }],
    [{ guild_id: "guild-1", normalized_emoji: "❌" }],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  assert.equal(isEmojiBlocked("❌", config, "guild-1"), true);
  assert.equal(config.guilds["guild-disabled"]?.enabled, false);
  assert.equal(config.botUserId, "bot-1");
});

test("guild-specific blocklists stay isolated per guild", () => {
  const config = buildBlocklistConfig(
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
  const config = buildBlocklistConfig([], [], []);

  assert.equal(config.botUserId, "");
});

test("legacy top-level emojis are ignored when evaluating the blocklist", () => {
  const config = buildBlocklistConfig([], [], []);

  assert.equal(isEmojiBlocked("✅", config, "guild-1"), false);
});

test("normalizeEmoji handles null and empty input", () => {
  assert.equal(normalizeEmoji(null), null);
  assert.equal(normalizeEmoji(""), null);
  assert.equal(normalizeEmoji(":blobcat:"), "blobcat");
});

test("getBlocklistFromStore reads the latest config from the moderation store", async () => {
  const expected = buildBlocklistConfig(
    [{ guild_id: "guild-1", moderation_enabled: 1 }],
    [{ guild_id: "guild-1", normalized_emoji: "❌" }],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  const actual = await getBlocklistFromStore(() =>
    Promise.resolve(Response.json(expected))
  );

  assert.deepEqual(actual, expected);
});

test("ModerationStoreDO starts with no globally blocked emojis", async () => {
  const sql = createFakeSql();
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;

  const store = new ModerationStoreDO(ctx, env);
  const response = await store.fetch(new Request("https://moderation-store/config"));
  const config = (await response.json()) as { guilds: Record<string, unknown>; botUserId: string };

  assert.deepEqual(config.guilds, {});
  assert.equal(config.botUserId, "bot-1");
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
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    })
  );
  const invalidInputResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", action: "remove" }),
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
        new Request("https://moderation-store/guild-emoji", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId: "guild-1",
            emoji: "✅",
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

test("guild-scoped emoji add and remove", async () => {
  const sql = createFakeSql();
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const addResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", emoji: "✅", action: "add" }),
    })
  );
  assert.equal(addResponse.status, 200);

  const addBody = (await addResponse.json()) as any;
  // Construct expected full config after add
  const expectedAfterAdd = buildBlocklistConfig(
    [{ guild_id: "guild-1", moderation_enabled: 1 }],
    [{ guild_id: "guild-1", normalized_emoji: "✅" }],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  assert.deepEqual(addBody, expectedAfterAdd);

  const configResponse = await store.fetch(new Request("https://moderation-store/config"));
  const config = (await configResponse.json()) as any;
  assert.deepEqual(config, expectedAfterAdd);

  const removeResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", emoji: "✅", action: "remove" }),
    })
  );
  assert.equal(removeResponse.status, 200);

  const removeBody = (await removeResponse.json()) as any;
  // Construct expected full config after remove
  const expectedAfterRemove = buildBlocklistConfig(
    [{ guild_id: "guild-1", moderation_enabled: 1 }],
    [],
    [{ key: "bot_user_id", value: "bot-1" }]
  );

  assert.deepEqual(removeBody, expectedAfterRemove);

  const configResponse2 = await store.fetch(new Request("https://moderation-store/config"));
  const config2 = (await configResponse2.json()) as any;
  assert.deepEqual(config2, expectedAfterRemove);
});

test("guild-scoped remove from untouched guild does not create guild settings", async () => {
  const sql = createFakeSql();
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const removeResponse = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "guild-untouched", emoji: "✅", action: "remove" }),
    })
  );

  assert.equal(removeResponse.status, 200);
  assert.deepEqual(
    await removeResponse.json(),
    buildBlocklistConfig(
      [],
      [],
      [{ key: "bot_user_id", value: "bot-1" }]
    )
  );

  const configResponse = await store.fetch(new Request("https://moderation-store/config"));
  assert.deepEqual(
    await configResponse.json(),
    buildBlocklistConfig(
      [],
      [],
      [{ key: "bot_user_id", value: "bot-1" }]
    )
  );
});

test("guild-scoped empty guild id is rejected", async () => {
  const sql = createFakeSql();
  const ctx = { storage: { sql } } as unknown as DurableObjectState;
  const env = { BOT_USER_ID: "bot-1" } as never;
  const store = new ModerationStoreDO(ctx, env);

  const response = await store.fetch(
    new Request("https://moderation-store/guild-emoji", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "", emoji: "✅", action: "add" }),
    })
  );

  assert.equal(response.status, 400);
});

// Focused test to verify the fake SQL distinguishes guild_settings from guild_blocked_emojis
test("createFakeSql distinguishes guild tables", () => {
  const sql = createFakeSql();

  // Insert only into guild_blocked_emojis
  sql.exec("INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)", "guild-1", "✅");

  const settingsResult = sql.exec("SELECT 1 FROM guild_settings LIMIT 1");
  const blockedResult = sql.exec("SELECT 1 FROM guild_blocked_emojis LIMIT 1");

  assert.deepEqual(settingsResult, []);
  assert.deepEqual(blockedResult, [{ 1: 1 }]);
});

test("ModerationStoreDO upserts and lists active timed roles by guild", async () => {
  const alarms: number[] = [];
  const ctx = {
    storage: {
      sql: createFakeSql(),
      setAlarm(time: number) {
        alarms.push(time);
        return Promise.resolve();
      },
    },
  } as unknown as DurableObjectState;

  const store = new ModerationStoreDO(
    ctx,
    { BOT_USER_ID: "bot-1", DISCORD_BOT_TOKEN: "token" } as never
  );

  const response = await store.fetch(
    new Request("https://moderation-store/timed-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        durationInput: "1w",
        expiresAtMs: 1_700_604_800_000,
      }),
    })
  );

  assert.equal(response.status, 200);

  const listResponse = await store.fetch(
    new Request("https://moderation-store/timed-roles?guildId=guild-1")
  );

  assert.deepEqual(await listResponse.json(), [
    {
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1w",
      expiresAtMs: 1_700_604_800_000,
    },
  ]);
  assert.deepEqual(alarms, [1_700_604_800_000]);
});

test("ModerationStoreDO replaces timed role expiry when upserting the same assignment", async () => {
  const originalNow = Date.now;
  const alarms: number[] = [];
  const sql = createFakeSql();
  const ctx = {
    storage: {
      sql,
      setAlarm(time: number) {
        alarms.push(time);
        return Promise.resolve();
      },
    },
  } as unknown as DurableObjectState;

  const store = new ModerationStoreDO(
    ctx,
    { BOT_USER_ID: "bot-1", DISCORD_BOT_TOKEN: "token" } as never
  );

  try {
    Date.now = () => 1_700_000_000_000;
    await store.fetch(
      new Request("https://moderation-store/timed-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
          durationInput: "1w",
          expiresAtMs: 1_700_604_800_000,
        }),
      })
    );

    Date.now = () => 1_700_000_060_000;
    await store.fetch(
      new Request("https://moderation-store/timed-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
          durationInput: "2h",
          expiresAtMs: 1_700_007_200_000,
        }),
      })
    );
  } finally {
    Date.now = originalNow;
  }

  const listResponse = await store.fetch(
    new Request("https://moderation-store/timed-roles?guildId=guild-1")
  );
  const storedRows = sql.exec(
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC",
    "guild-1"
  ) as Array<{
    created_at_ms: number;
    duration_input: string;
    expires_at_ms: number;
    updated_at_ms: number;
  }>;

  assert.deepEqual(await listResponse.json(), [
    {
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "2h",
      expiresAtMs: 1_700_007_200_000,
    },
  ]);
  assert.equal(storedRows.length, 1);
  assert.equal(storedRows[0]?.duration_input, "2h");
  assert.equal(storedRows[0]?.expires_at_ms, 1_700_007_200_000);
  assert.equal(storedRows[0]?.created_at_ms, 1_700_000_000_000);
  assert.equal(storedRows[0]?.updated_at_ms, 1_700_000_060_000);
  assert.deepEqual(alarms, [1_700_604_800_000, 1_700_007_200_000]);
});

test("ModerationStoreDO removes timed roles via route", async () => {
  const ctx = {
    storage: {
      sql: createFakeSql(),
      setAlarm() {
        return Promise.resolve();
      },
    },
  } as unknown as DurableObjectState;
  const store = new ModerationStoreDO(
    ctx,
    { BOT_USER_ID: "bot-1", DISCORD_BOT_TOKEN: "token" } as never
  );

  await store.fetch(
    new Request("https://moderation-store/timed-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        durationInput: "1w",
        expiresAtMs: 1_700_604_800_000,
      }),
    })
  );

  const deleteResponse = await store.fetch(
    new Request("https://moderation-store/timed-role/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
      }),
    })
  );

  assert.equal(deleteResponse.status, 200);

  const listResponse = await store.fetch(
    new Request("https://moderation-store/timed-roles?guildId=guild-1")
  );
  assert.deepEqual(await listResponse.json(), []);
});

test("ModerationStoreDO clears the timed role alarm when the last assignment is removed", async () => {
  const alarms: number[] = [];
  let deleteAlarmCalls = 0;
  const ctx = {
    storage: {
      sql: createFakeSql(),
      setAlarm(time: number) {
        alarms.push(time);
        return Promise.resolve();
      },
      deleteAlarm() {
        deleteAlarmCalls += 1;
        return Promise.resolve();
      },
    },
  } as unknown as DurableObjectState;
  const store = new ModerationStoreDO(
    ctx,
    { BOT_USER_ID: "bot-1", DISCORD_BOT_TOKEN: "token" } as never
  );

  await store.fetch(
    new Request("https://moderation-store/timed-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        durationInput: "1w",
        expiresAtMs: 1_700_604_800_000,
      }),
    })
  );

  const deleteResponse = await store.fetch(
    new Request("https://moderation-store/timed-role/remove", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
      }),
    })
  );

  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(alarms, [1_700_604_800_000]);
  assert.equal(deleteAlarmCalls, 1);
});

test("ModerationStoreDO alarm only removes timed roles after Discord role removal succeeds", async () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const alarms: number[] = [];
  const discordCalls: Array<{ input: string; method: string | undefined }> = [];
  let shouldFailRemoval = true;

  Date.now = () => now;
  console.error = () => {};
  globalThis.fetch = async (input, init) => {
    discordCalls.push({
      input: String(input),
      method: init?.method,
    });

    if (shouldFailRemoval) {
      return new Response("discord unavailable", { status: 500 });
    }

    return new Response(null, { status: 204 });
  };

  try {
    const ctx = {
      storage: {
        sql: createFakeSql(),
        setAlarm(time: number) {
          alarms.push(time);
          return Promise.resolve();
        },
      },
    } as unknown as DurableObjectState;
    const store = new ModerationStoreDO(
      ctx,
      { BOT_USER_ID: "bot-1", DISCORD_BOT_TOKEN: "token" } as never
    );

    await store.fetch(
      new Request("https://moderation-store/timed-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
          durationInput: "5m",
          expiresAtMs: now - 1,
        }),
      })
    );
    await store.fetch(
      new Request("https://moderation-store/timed-role", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: "guild-1",
          userId: "user-2",
          roleId: "role-2",
          durationInput: "10m",
          expiresAtMs: now + 60_000,
        }),
      })
    );

    await (store as ModerationStoreDO & { alarm(): Promise<void> }).alarm();

    const afterFailedAlarm = await store.fetch(
      new Request("https://moderation-store/timed-roles?guildId=guild-1")
    );
    assert.deepEqual(await afterFailedAlarm.json(), [
      {
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        durationInput: "5m",
        expiresAtMs: now - 1,
      },
      {
        guildId: "guild-1",
        userId: "user-2",
        roleId: "role-2",
        durationInput: "10m",
        expiresAtMs: now + 60_000,
      },
    ]);

    shouldFailRemoval = false;
    await (store as ModerationStoreDO & { alarm(): Promise<void> }).alarm();

    const afterSuccessfulAlarm = await store.fetch(
      new Request("https://moderation-store/timed-roles?guildId=guild-1")
    );
    assert.deepEqual(await afterSuccessfulAlarm.json(), [
      {
        guildId: "guild-1",
        userId: "user-2",
        roleId: "role-2",
        durationInput: "10m",
        expiresAtMs: now + 60_000,
      },
    ]);

    assert.deepEqual(
      discordCalls.map((call) => ({
        method: call.method,
        input: call.input,
      })),
      [
        {
          method: "DELETE",
          input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
        },
        {
          method: "DELETE",
          input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
        },
      ]
    );
    assert.deepEqual(alarms, [now - 1, now - 1, now - 1, now + 60_000]);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
  }
});

function createFakeSql(options?: {
  failOnDelete?: boolean;
  failOnSelectConfig?: boolean;
  appConfigEntries?: Array<[string, string]>;
}) {
  const appConfig = new Map<string, string>(options?.appConfigEntries ?? []);
  const guildSettings = new Map<string, number>();
  const guildBlockedEmojis = new Map<string, Set<string>>();
  const timedRoles = new Map<
    string,
    {
      guild_id: string;
      user_id: string;
      role_id: string;
      duration_input: string;
      expires_at_ms: number;
      created_at_ms: number;
      updated_at_ms: number;
    }
  >();

  return {
    exec(query: string, ...params: unknown[]) {
      if (query.includes("CREATE TABLE IF NOT EXISTS")) {
        return [];
      }

      if (
        query === "INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, ?)"
      ) {
        const [guildId, moderationEnabled] = params as [string, number];
        if (!guildSettings.has(guildId)) {
          guildSettings.set(guildId, moderationEnabled);
        }
        return [];
      }

      if (
        query === "INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)"
      ) {
        const [guildId, normalizedEmoji] = params as [string, string];
        const set = guildBlockedEmojis.get(guildId) ?? new Set<string>();
        set.add(normalizedEmoji);
        guildBlockedEmojis.set(guildId, set);
        return [];
      }

      if (
        query ===
        "DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?"
      ) {
        if (options?.failOnDelete) {
          throw new Error("storage fault");
        }

        const [guildId, normalizedEmoji] = params as [string, string];
        guildBlockedEmojis.get(guildId)?.delete(normalizedEmoji);
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

      if (query === "SELECT guild_id, moderation_enabled FROM guild_settings") {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        return [...guildSettings.entries()].map(([guild_id, moderation_enabled]) => ({ guild_id, moderation_enabled }));
      }

      if (query === "SELECT guild_id, normalized_emoji FROM guild_blocked_emojis") {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        const rows: Array<{ guild_id: string; normalized_emoji: string }> = [];
        for (const [guild_id, set] of guildBlockedEmojis.entries()) {
          for (const normalized_emoji of set) {
            rows.push({ guild_id, normalized_emoji });
          }
        }

        return rows;
      }

      if (query === "SELECT 1 FROM guild_settings LIMIT 1") {
        return guildSettings.size > 0 ? [{ 1: 1 }] : [];
      }

      if (query === "SELECT 1 FROM guild_blocked_emojis LIMIT 1") {
        const hasGuildBlocked = Array.from(guildBlockedEmojis.values()).some((s) => s.size > 0);
        return hasGuildBlocked ? [{ 1: 1 }] : [];
      }

      if (query === "SELECT 1 FROM app_config LIMIT 1") {
        return appConfig.size > 0 ? [{ 1: 1 }] : [];
      }

      if (query === "SELECT 1 FROM timed_roles LIMIT 1") {
        return timedRoles.size > 0 ? [{ 1: 1 }] : [];
      }

      if (query === "SELECT key, value FROM app_config") {
        if (options?.failOnSelectConfig) {
          throw new Error("storage fault");
        }

        return [...appConfig.entries()].map(([key, value]) => ({ key, value }));
      }

      if (
        query ===
        "INSERT INTO timed_roles(guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET duration_input = excluded.duration_input, expires_at_ms = excluded.expires_at_ms, updated_at_ms = excluded.updated_at_ms"
      ) {
        const [
          guild_id,
          user_id,
          role_id,
          duration_input,
          expires_at_ms,
          created_at_ms,
          updated_at_ms,
        ] = params as [string, string, string, string, number, number, number];
        const key = `${guild_id}:${user_id}:${role_id}`;
        const existing = timedRoles.get(key);
        timedRoles.set(key, {
          guild_id,
          user_id,
          role_id,
          duration_input,
          expires_at_ms,
          created_at_ms: existing?.created_at_ms ?? created_at_ms,
          updated_at_ms,
        });
        return [];
      }

      if (
        query ===
        "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC"
      ) {
        return [...timedRoles.values()]
          .filter((row) => row.guild_id === params[0])
          .sort((a, b) => a.expires_at_ms - b.expires_at_ms)
          .map(({
            guild_id,
            user_id,
            role_id,
            duration_input,
            expires_at_ms,
            created_at_ms,
            updated_at_ms,
          }) => ({
            guild_id,
            user_id,
            role_id,
            duration_input,
            expires_at_ms,
            created_at_ms,
            updated_at_ms,
          }));
      }

      if (
        query ===
        "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE expires_at_ms <= ? ORDER BY expires_at_ms ASC"
      ) {
        return [...timedRoles.values()]
          .filter((row) => row.expires_at_ms <= (params[0] as number))
          .sort((a, b) => a.expires_at_ms - b.expires_at_ms)
          .map(({
            guild_id,
            user_id,
            role_id,
            duration_input,
            expires_at_ms,
            created_at_ms,
            updated_at_ms,
          }) => ({
            guild_id,
            user_id,
            role_id,
            duration_input,
            expires_at_ms,
            created_at_ms,
            updated_at_ms,
          }));
      }

      if (
        query === "DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?"
      ) {
        timedRoles.delete(`${params[0]}:${params[1]}:${params[2]}`);
        return [];
      }

      if (query === "SELECT expires_at_ms FROM timed_roles ORDER BY expires_at_ms ASC LIMIT 1") {
        const first = [...timedRoles.values()].sort(
          (a, b) => a.expires_at_ms - b.expires_at_ms
        )[0];
        return first ? [{ expires_at_ms: first.expires_at_ms }] : [];
      }

      throw new Error(`Unexpected SQL: ${query}`);
    },
  };
}
