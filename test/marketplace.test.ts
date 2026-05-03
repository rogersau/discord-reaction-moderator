/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import {
  buildMarketplacePostModal,
  buildMarketplaceServerResponse,
  buildMarketplaceWarningResponse,
  parseMarketplaceCustomId,
} from "../src/marketplace";
import {
  MarketplaceActivePostError,
  MarketplaceService,
} from "../src/services/marketplace-service";
import type { MarketplaceBusinessLog, MarketplaceConfig, MarketplacePost } from "../src/types";

test("marketplace custom IDs parse supported actions", () => {
  assert.deepEqual(parseMarketplaceCustomId("market:create"), { action: "create" });
  assert.deepEqual(parseMarketplaceCustomId("market:type:have"), {
    action: "type",
    tradeType: "have",
  });
  assert.deepEqual(parseMarketplaceCustomId("market:server:want:namalsk"), {
    action: "server",
    tradeType: "want",
    serverId: "namalsk",
  });
  assert.deepEqual(parseMarketplaceCustomId("market:modal:have:chernarus"), {
    action: "modal",
    tradeType: "have",
    serverId: "chernarus",
  });
  assert.deepEqual(parseMarketplaceCustomId("market:biz:post-1"), {
    action: "business",
    postId: "post-1",
  });
  assert.equal(parseMarketplaceCustomId("ticket:open:support"), null);
});

test("marketplace builders create Discord modal and warning responses", () => {
  const modal = buildMarketplacePostModal("have", "namalsk");
  assert.equal(modal.type, 9);
  assert.equal(modal.data.custom_id, "market:modal:have:namalsk");
  assert.equal(modal.data.components[0].components[0].custom_id, "have");
  assert.equal(modal.data.components[0].components[0].required, true);
  assert.equal(modal.data.components[1].components[0].required, false);

  const warning = buildMarketplaceWarningResponse("post-1");
  assert.equal(warning.type, 4);
  assert.equal(warning.data.flags, 64);
  assert.match(warning.data.content, /Scamming/);
  assert.equal(warning.data.components[0].components[0].custom_id, "market:confirm:post-1");
});

test("marketplace server response uses configured server options", () => {
  const response = buildMarketplaceServerResponse(createConfig(), "want");
  assert.equal(response.type, 7);
  assert.equal(response.data.components[0].components[0].custom_id, "market:server:want:namalsk");
  assert.equal(response.data.components[0].components[1].label, "Chernarus");
});

test("MarketplaceService creates posts and rejects duplicate active owner posts", async () => {
  const store = createStore();
  const discordCalls: string[] = [];
  const service = new MarketplaceService(store, {
    async createChannelMessage(channelId) {
      discordCalls.push(`message:${channelId}`);
      return { id: `message-${discordCalls.length}`, channel_id: channelId, content: "" };
    },
    async editChannelMessage() {
      throw new Error("unexpected edit");
    },
    async deleteChannelMessage() {
      discordCalls.push("delete-notice");
    },
    async createUserDmMessage() {
      throw new Error("unexpected dm");
    },
  });

  const post = await service.createPost({
    guildId: "guild-1",
    channelId: "channel-1",
    ownerId: "owner-1",
    ownerDisplayName: "Owner",
    tradeType: "have",
    serverId: "namalsk",
    have: "M4A1",
    want: "NVGs",
    extra: "Safe zone",
  });

  assert.equal(post.messageId, "message-1");
  assert.equal(store.posts.length, 1);
  assert.deepEqual(discordCalls, ["message:channel-1", "message:channel-1"]);
  await assert.rejects(
    service.createPost({
      guildId: "guild-1",
      channelId: "channel-1",
      ownerId: "owner-1",
      ownerDisplayName: "Owner",
      tradeType: "want",
      serverId: "namalsk",
      have: "",
      want: "Ammo",
      extra: "",
    }),
    MarketplaceActivePostError,
  );
});

test("MarketplaceService confirms business, logs DM success, and posts admin log", async () => {
  const store = createStore();
  store.posts.push(createPost());
  const discordCalls: string[] = [];
  const service = new MarketplaceService(store, {
    async createChannelMessage(channelId) {
      discordCalls.push(`channel:${channelId}`);
      return { id: "message-1", channel_id: channelId, content: "" };
    },
    async editChannelMessage() {
      throw new Error("unexpected edit");
    },
    async deleteChannelMessage() {
      throw new Error("unexpected delete");
    },
    async createUserDmMessage(userId) {
      discordCalls.push(`dm:${userId}`);
      return { id: "dm-1", channel_id: "dm-channel", content: "" };
    },
  });

  const result = await service.confirmBusiness({
    guildId: "guild-1",
    postId: "post-1",
    buyerId: "buyer-1",
    buyerDisplayName: "Buyer",
  });

  assert.deepEqual(result, { dmSent: true });
  assert.equal(store.logs.length, 1);
  assert.equal(store.logs[0]?.buyerId, "buyer-1");
  assert.equal(store.logs[0]?.dmSent, true);
  assert.deepEqual(discordCalls, ["dm:owner-1", "channel:log-channel-1"]);
});

function createConfig(): MarketplaceConfig {
  return {
    guildId: "guild-1",
    noticeChannelId: null,
    noticeMessageId: null,
    logChannelId: "log-channel-1",
    serverOptions: [
      { id: "namalsk", label: "Namalsk", emoji: "🧊" },
      { id: "chernarus", label: "Chernarus", emoji: "🌲" },
    ],
    updatedAtMs: 1,
  };
}

function createPost(): MarketplacePost {
  return {
    guildId: "guild-1",
    id: "post-1",
    ownerId: "owner-1",
    ownerDisplayName: "Owner",
    tradeType: "have",
    serverId: "namalsk",
    serverLabel: "Namalsk",
    have: "M4A1",
    want: "NVGs",
    extra: "Safe zone",
    channelId: "channel-1",
    messageId: "message-1",
    active: true,
    createdAtMs: 1,
    closedAtMs: null,
    closedByUserId: null,
  };
}

function createStore() {
  const config = createConfig();
  const posts: MarketplacePost[] = [];
  const logs: MarketplaceBusinessLog[] = [];

  return {
    posts,
    logs,
    async readMarketplaceConfig() {
      return config;
    },
    async upsertMarketplaceConfig(nextConfig: MarketplaceConfig) {
      Object.assign(config, nextConfig);
    },
    async listMarketplacePosts() {
      return posts;
    },
    async readMarketplacePost(_guildId: string, postId: string) {
      return posts.find((post) => post.id === postId) ?? null;
    },
    async readActiveMarketplacePostByOwner(_guildId: string, ownerId: string) {
      return posts.find((post) => post.ownerId === ownerId && post.active) ?? null;
    },
    async createMarketplacePost(post: MarketplacePost) {
      posts.push(post);
    },
    async updateMarketplacePostMessage(body: { postId: string; messageId: string }) {
      const post = posts.find((entry) => entry.id === body.postId);
      if (post) post.messageId = body.messageId;
    },
    async closeMarketplacePost(body: {
      postId: string;
      closedByUserId: string;
      closedAtMs: number;
    }) {
      const post = posts.find((entry) => entry.id === body.postId);
      if (!post) throw new Error("missing post");
      post.active = false;
      post.closedByUserId = body.closedByUserId;
      post.closedAtMs = body.closedAtMs;
      return post;
    },
    async listMarketplaceLogs() {
      return logs;
    },
    async createMarketplaceLog(log: MarketplaceBusinessLog) {
      logs.push(log);
    },
  };
}
