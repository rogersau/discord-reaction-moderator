import {
  buildLfgDmMessage,
  buildLfgNoticeMessage,
  buildLfgPostMessage,
} from "../lfg";
import type { CreateChannelMessageInput, DiscordMessageResource } from "../discord";
import type { LfgConfig, LfgPost } from "../types";
import type { LfgStore } from "../runtime/contracts";

export interface LfgDiscordApi {
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

export class LfgService {
  constructor(
    private readonly store: LfgStore,
    private readonly discord: LfgDiscordApi,
  ) {}

  async getConfig(guildId: string): Promise<LfgConfig> {
    return (await this.store.readLfgConfig(guildId)) ?? defaultLfgConfig(guildId);
  }

  async updateConfig(config: LfgConfig): Promise<LfgConfig> {
    const nextConfig = { ...config, updatedAtMs: Date.now() };
    await this.store.upsertLfgConfig(nextConfig);
    return nextConfig;
  }

  async setupNotice(guildId: string, channelId: string): Promise<LfgConfig> {
    const config = await this.getConfig(guildId);
    if (config.noticeChannelId && config.noticeMessageId) {
      await this.discord
        .deleteChannelMessage(config.noticeChannelId, config.noticeMessageId)
        .catch(() => undefined);
    }

    const message = await this.discord.createChannelMessage(
      channelId,
      buildLfgNoticeMessage(),
    );
    const nextConfig = {
      ...config,
      noticeChannelId: channelId,
      noticeMessageId: message.id,
      updatedAtMs: Date.now(),
    };
    await this.store.upsertLfgConfig(nextConfig);
    return nextConfig;
  }

  async listPosts(guildId: string): Promise<LfgPost[]> {
    return this.store.listLfgPosts(guildId, { limit: 50 });
  }

  async createPost(input: {
    guildId: string;
    channelId: string;
    ownerId: string;
    ownerDisplayName: string;
    serverId: string;
    whenPlay: string;
    lookingFor: string;
    extraInfo: string;
  }): Promise<LfgPost> {
    const activePost = await this.store.readActiveLfgPostByOwner(
      input.guildId,
      input.ownerId,
    );
    if (activePost) {
      throw new LfgActivePostError();
    }

    const config = await this.getConfig(input.guildId);
    const server = config.serverOptions.find((option) => option.id === input.serverId);
    if (!server) {
      throw new LfgConfigError("That server option is no longer available.");
    }

    const post: LfgPost = {
      guildId: input.guildId,
      id: `${Date.now()}-${input.ownerId}`,
      ownerId: input.ownerId,
      ownerDisplayName: input.ownerDisplayName,
      serverId: server.id,
      serverLabel: server.label,
      whenPlay: input.whenPlay,
      lookingFor: input.lookingFor,
      extraInfo: input.extraInfo,
      channelId: input.channelId,
      messageId: null,
      active: true,
      createdAtMs: Date.now(),
      closedAtMs: null,
      closedByUserId: null,
    };

    await this.store.createLfgPost(post);
    const message = await this.discord.createChannelMessage(
      input.channelId,
      buildLfgPostMessage(post),
    );
    const postWithMessage = { ...post, messageId: message.id };
    await this.store.updateLfgPostMessage({
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
  }): Promise<LfgPost> {
    const closedPost = await this.store.closeLfgPost({
      guildId: input.guildId,
      postId: input.postId,
      closedByUserId: input.closedByUserId,
      closedAtMs: Date.now(),
    });
    if (closedPost.messageId) {
      await this.discord.editChannelMessage(
        closedPost.channelId,
        closedPost.messageId,
        buildLfgPostMessage(closedPost),
      );
    }
    return closedPost;
  }

  async notifyOwner(input: {
    guildId: string;
    postId: string;
    interestedUserId: string;
    interestedUserDisplayName: string;
  }): Promise<{ dmSent: boolean }> {
    const post = await this.store.readLfgPost(input.guildId, input.postId);
    if (!post || !post.active) {
      throw new LfgConfigError("This LFG post is no longer active.");
    }
    if (post.ownerId === input.interestedUserId) {
      throw new LfgConfigError("You cannot mark yourself as interested in your own post.");
    }

    let dmSent = false;
    try {
      await this.discord.createUserDmMessage(
        post.ownerId,
        buildLfgDmMessage(input.interestedUserId, input.interestedUserDisplayName, post),
      );
      dmSent = true;
    } catch (error) {
      console.warn("Could not DM LFG owner", error);
    }

    return { dmSent };
  }
}

export class LfgActivePostError extends Error {
  constructor() {
    super("You already have an active LFG post. Please close it before creating another.");
  }
}

export class LfgConfigError extends Error {}

function defaultLfgConfig(guildId: string): LfgConfig {
  return {
    guildId,
    noticeChannelId: null,
    noticeMessageId: null,
    serverOptions: [
      { id: "namalsk", label: "Namalsk", emoji: "🧊" },
      { id: "chernarus", label: "Chernarus", emoji: "🌲" },
      { id: "both", label: "Both", emoji: "🔁" },
    ],
    updatedAtMs: Date.now(),
  };
}
