declare const require: (id: string) => unknown;

type TestFn = (name: string, fn: () => void) => void;
type Assert = { equal(actual: unknown, expected: unknown): void };

const test = require("node:test") as TestFn;
const assert = require("node:assert/strict") as Assert;

import {
  buildBlocklistConfig,
  isEmojiBlocked,
  normalizeEmoji,
} from "../src/blocklist";

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

test("normalizeEmoji handles null and empty input", () => {
  assert.equal(normalizeEmoji(null), null);
  assert.equal(normalizeEmoji(""), null);
  assert.equal(normalizeEmoji(":blobcat:"), "blobcat");
});
