import {
  buildMarketplaceDmMessage,
  buildMarketplaceLogMessage,
  buildMarketplaceNoticeMessage,
  buildMarketplacePostMessage,
} from "../marketplace";
import type { CreateChannelMessageInput, DiscordMessageResource } from "../discord";
import type {
  MarketplaceBusinessLog,
  MarketplaceConfig,
  MarketplacePost,
  MarketplaceTradeType,
} from "../types";
import type { MarketplaceStore } from "../runtime/contracts";

export interface MarketplaceDiscordApi {
  createChannelMessage(
    channelId: string,
    body: CreateChannelMessageInput,
  ): Promise<DiscordMessageResource>;
  editChannelMessage(
    channelId: string,
    messageId: string,
    body: CreateChannelMessageInput,
  ): Promise<DiscordMessageResource>;
  deleteChannelMessage(channelId: string, messageId: string): Promise<void>;
  createUserDmMessage(
    userId: string,
    body: CreateChannelMessageInput,
  ): Promise<DiscordMessageResource>;
}

export class MarketplaceService {
  constructor(
    private readonly store: MarketplaceStore,
    private readonly discord: MarketplaceDiscordApi,
  ) {}

  async getConfig(guildId: string): Promise<MarketplaceConfig> {
    return (await this.store.readMarketplaceConfig(guildId)) ?? defaultMarketplaceConfig(guildId);
  }

  async updateConfig(config: MarketplaceConfig): Promise<MarketplaceConfig> {
    const nextConfig = { ...config, updatedAtMs: Date.now() };
    await this.store.upsertMarketplaceConfig(nextConfig);
    return nextConfig;
  }

  async setupNotice(guildId: string, channelId: string): Promise<MarketplaceConfig> {
    const config = await this.getConfig(guildId);
    if (config.noticeChannelId && config.noticeMessageId) {
      await this.discord
        .deleteChannelMessage(config.noticeChannelId, config.noticeMessageId)
        .catch(() => undefined);
    }

    const message = await this.discord.createChannelMessage(
      channelId,
      buildMarketplaceNoticeMessage(),
    );
    const nextConfig = {
      ...config,
      noticeChannelId: channelId,
      noticeMessageId: message.id,
      updatedAtMs: Date.now(),
    };
    await this.store.upsertMarketplaceConfig(nextConfig);
    return nextConfig;
  }

  async listPosts(guildId: string): Promise<MarketplacePost[]> {
    return this.store.listMarketplacePosts(guildId, { limit: 50 });
  }

  async listLogs(guildId: string, limit = 10): Promise<MarketplaceBusinessLog[]> {
    return this.store.listMarketplaceLogs(guildId, limit);
  }

  async createPost(input: {
    guildId: string;
    channelId: string;
    ownerId: string;
    ownerDisplayName: string;
    tradeType: MarketplaceTradeType;
    serverId: string;
    have: string;
    want: string;
    extra: string;
  }): Promise<MarketplacePost> {
    const activePost = await this.store.readActiveMarketplacePostByOwner(
      input.guildId,
      input.ownerId,
    );
    if (activePost) {
      throw new MarketplaceActivePostError();
    }

    const config = await this.getConfig(input.guildId);
    const server = config.serverOptions.find((option) => option.id === input.serverId);
    if (!server) {
      throw new MarketplaceConfigError("That marketplace server option is no longer available.");
    }

    const post: MarketplacePost = {
      guildId: input.guildId,
      id: `${Date.now()}-${input.ownerId}`,
      ownerId: input.ownerId,
      ownerDisplayName: input.ownerDisplayName,
      tradeType: input.tradeType,
      serverId: server.id,
      serverLabel: server.label,
      have: input.have,
      want: input.want,
      extra: input.extra,
      channelId: input.channelId,
      messageId: null,
      active: true,
      createdAtMs: Date.now(),
      closedAtMs: null,
      closedByUserId: null,
    };

    await this.store.createMarketplacePost(post);
    const message = await this.discord.createChannelMessage(
      input.channelId,
      buildMarketplacePostMessage(post),
    );
    const postWithMessage = { ...post, messageId: message.id };
    await this.store.updateMarketplacePostMessage({
      guildId: post.guildId,
      postId: post.id,
      messageId: message.id,
    });
    await this.setupNotice(input.guildId, input.channelId).catch(() => undefined);
    return postWithMessage;
  }

  async closePost(input: {
    guildId: string;
    postId: string;
    closedByUserId: string;
  }): Promise<MarketplacePost> {
    const closedPost = await this.store.closeMarketplacePost({
      guildId: input.guildId,
      postId: input.postId,
      closedByUserId: input.closedByUserId,
      closedAtMs: Date.now(),
    });
    if (closedPost.messageId) {
      await this.discord.editChannelMessage(
        closedPost.channelId,
        closedPost.messageId,
        buildMarketplacePostMessage(closedPost),
      );
    }
    return closedPost;
  }

  async confirmBusiness(input: {
    guildId: string;
    postId: string;
    buyerId: string;
    buyerDisplayName: string;
  }): Promise<{ dmSent: boolean }> {
    const post = await this.store.readMarketplacePost(input.guildId, input.postId);
    if (!post || !post.active) {
      throw new MarketplaceConfigError("This marketplace post is no longer active.");
    }
    if (post.ownerId === input.buyerId) {
      throw new MarketplaceConfigError("You cannot do business with your own post.");
    }

    let dmSent = false;
    let dmError: string | null = null;
    try {
      await this.discord.createUserDmMessage(
        post.ownerId,
        buildMarketplaceDmMessage(input.buyerId, input.buyerDisplayName, post),
      );
      dmSent = true;
    } catch (error) {
      dmError = error instanceof Error ? error.message : "Failed to send DM";
    }

    const log: MarketplaceBusinessLog = {
      guildId: input.guildId,
      id: `${Date.now()}-${input.buyerId}`,
      timestampMs: Date.now(),
      buyerId: input.buyerId,
      buyerDisplayName: input.buyerDisplayName,
      sellerId: post.ownerId,
      postId: post.id,
      channelId: post.channelId,
      messageId: post.messageId,
      tradeType: post.tradeType,
      serverLabel: post.serverLabel,
      dmSent,
      dmError,
      have: post.have,
      want: post.want,
    };
    await this.store.createMarketplaceLog(log);

    const config = await this.getConfig(input.guildId);
    if (config.logChannelId) {
      await this.discord
        .createChannelMessage(config.logChannelId, buildMarketplaceLogMessage(log))
        .catch((error) => {
          console.error("Failed to post marketplace log", error);
        });
    }

    return { dmSent };
  }
}

export class MarketplaceActivePostError extends Error {
  constructor() {
    super("You already have an active marketplace post. Please close it before creating another.");
  }
}

export class MarketplaceConfigError extends Error {}

function defaultMarketplaceConfig(guildId: string): MarketplaceConfig {
  return {
    guildId,
    noticeChannelId: null,
    noticeMessageId: null,
    logChannelId: null,
    serverOptions: [
      { id: "namalsk", label: "Namalsk", emoji: "🧊" },
      { id: "chernarus", label: "Chernarus", emoji: "🌲" },
    ],
    updatedAtMs: Date.now(),
  };
}
