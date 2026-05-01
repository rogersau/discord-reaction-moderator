import type { BlocklistStore } from "../runtime/contracts";
import { applyGuildEmojiMutation as applyGuildEmojiMutationWorkflow } from "./blocklist/apply-guild-emoji-mutation";
import { getGuildBlocklist as getGuildBlocklistWorkflow } from "./blocklist/get-guild-blocklist";
import {
  buildBlocklistUpdateMessage,
  postGuildModerationUpdate,
  type ChannelMessageSender,
  type GuildNotificationChannelStore,
  type ModerationActionActor,
} from "./moderation-log";

export interface BlocklistMutation {
  guildId: string;
  action: "add" | "remove";
  emoji: string;
}

export class BlocklistService {
  constructor(
    private readonly store: BlocklistStore & Partial<GuildNotificationChannelStore>,
    private readonly sendChannelMessage?: ChannelMessageSender,
  ) {}

  async applyMutation(mutation: BlocklistMutation): Promise<void> {
    await applyGuildEmojiMutationWorkflow(this.store, mutation);
  }

  async getGuildBlocklist(guildId: string): Promise<{ enabled: boolean; emojis: string[] }> {
    return getGuildBlocklistWorkflow(this.store, guildId);
  }

  async getGuildNotificationChannel(guildId: string): Promise<string | null> {
    if (typeof this.store.readGuildNotificationChannel !== "function") {
      return null;
    }

    return this.store.readGuildNotificationChannel(guildId);
  }

  async updateGuildNotificationChannel(
    guildId: string,
    notificationChannelId: string | null,
  ): Promise<void> {
    if (typeof this.store.upsertGuildNotificationChannel !== "function") {
      return;
    }

    await this.store.upsertGuildNotificationChannel({
      guildId,
      notificationChannelId,
    });
  }

  async addEmoji(
    guildId: string,
    emoji: string,
    actor?: ModerationActionActor,
  ): Promise<{ alreadyBlocked: boolean }> {
    const guildConfig = await this.getGuildBlocklist(guildId);
    const isAlreadyBlocked = guildConfig.emojis.includes(emoji);

    if (!isAlreadyBlocked) {
      await this.applyMutation({ guildId, emoji, action: "add" });
      await postGuildModerationUpdate(
        this.store,
        this.sendChannelMessage,
        guildId,
        buildBlocklistUpdateMessage({ action: "add", emoji, actor }),
      );
    }

    return { alreadyBlocked: isAlreadyBlocked };
  }

  async removeEmoji(
    guildId: string,
    emoji: string,
    actor?: ModerationActionActor,
  ): Promise<{ wasBlocked: boolean }> {
    const guildConfig = await this.getGuildBlocklist(guildId);
    const isBlocked = guildConfig.emojis.includes(emoji);

    if (isBlocked) {
      await this.applyMutation({ guildId, emoji, action: "remove" });
      await postGuildModerationUpdate(
        this.store,
        this.sendChannelMessage,
        guildId,
        buildBlocklistUpdateMessage({ action: "remove", emoji, actor }),
      );
    }

    return { wasBlocked: isBlocked };
  }
}
