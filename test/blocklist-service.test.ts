/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { BlocklistService } from "../src/services/blocklist-service";
import type { BlocklistStore } from "../src/runtime/contracts";

test("BlocklistService.addEmoji posts a moderation update when a channel is configured", async () => {
  const blockedEmojis: string[] = [];
  const postedMessages: Array<{
    channelId: string;
    body: { content?: string; allowed_mentions?: { parse?: string[] } };
  }> = [];

  const store = {
    async readConfig() {
      return {
        guilds: {
          "guild-1": {
            enabled: true,
            emojis: [...blockedEmojis],
          },
        },
        botUserId: "bot-1",
      };
    },
    async applyGuildEmojiMutation(body: {
      guildId: string;
      emoji: string;
      action: "add" | "remove";
    }) {
      if (body.action === "add" && !blockedEmojis.includes(body.emoji)) {
        blockedEmojis.push(body.emoji);
      }

      return {
        guilds: {
          [body.guildId]: {
            enabled: true,
            emojis: [...blockedEmojis],
          },
        },
        botUserId: "bot-1",
      };
    },
    async readGuildNotificationChannel() {
      return "log-channel-1";
    },
  } satisfies BlocklistStore & {
    readGuildNotificationChannel(guildId: string): Promise<string | null>;
  };

  const service = new BlocklistService(store, async (channelId, body) => {
    postedMessages.push({ channelId, body });
  });

  const result = await service.addEmoji("guild-1", "✅", {
    label: "Slash command",
    userId: "admin-1",
  });

  assert.equal(result.alreadyBlocked, false);
  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0]?.channelId, "log-channel-1");
  assert.equal(postedMessages[0]?.body.content, "🧱 Blocklist update by <@admin-1>: blocked ✅.");
  assert.deepEqual(postedMessages[0]?.body.allowed_mentions, { parse: [] });
});

test("BlocklistService does not post a moderation update for a duplicate add", async () => {
  const store = {
    async readConfig() {
      return {
        guilds: {
          "guild-1": {
            enabled: true,
            emojis: ["✅"],
          },
        },
        botUserId: "bot-1",
      };
    },
    async applyGuildEmojiMutation() {
      throw new Error("should not mutate");
    },
    async readGuildNotificationChannel() {
      return "log-channel-1";
    },
  } satisfies BlocklistStore & {
    readGuildNotificationChannel(guildId: string): Promise<string | null>;
  };

  const postedMessages: Array<{
    channelId: string;
    body: { content?: string; allowed_mentions?: { parse?: string[] } };
  }> = [];
  const service = new BlocklistService(store, async (channelId, body) => {
    postedMessages.push({ channelId, body });
  });

  const result = await service.addEmoji("guild-1", "✅", {
    label: "Slash command",
    userId: "admin-1",
  });

  assert.equal(result.alreadyBlocked, true);
  assert.deepEqual(postedMessages, []);
});
