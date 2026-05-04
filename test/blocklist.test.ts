/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import {
  buildBlocklistConfig,
  getBlocklistFromStore,
  isEmojiBlocked,
  normalizeEmoji,
} from "../src/blocklist";
import { getGuildBlocklist } from "../src/services/blocklist/get-guild-blocklist";

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

test("buildBlocklistConfig materializes guild rules", () => {
  const config = buildBlocklistConfig(
    [{ guild_id: "guild-disabled", moderation_enabled: 0 }],
    [{ guild_id: "guild-1", normalized_emoji: "❌" }],
    [{ key: "bot_user_id", value: "bot-1" }],
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
    [],
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
    [{ key: "bot_user_id", value: "bot-1" }],
  );

  const actual = await getBlocklistFromStore(() => Promise.resolve(Response.json(expected)));

  assert.deepEqual(actual, expected);
});test("getGuildBlocklist falls back to an enabled empty state for unknown guilds", async () => {
  const result = await getGuildBlocklist(
    {
      readConfig: async () => ({ botUserId: "bot", guilds: {} }),
    },
    "missing-guild",
  );

  assert.deepEqual(result, { enabled: true, emojis: [] });
});