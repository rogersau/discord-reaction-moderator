import type { RuntimeStore } from "../runtime/contracts";

export interface BlocklistMutation {
  guildId: string;
  action: "add" | "remove";
  emoji: string;
}

export class BlocklistService {
  constructor(private readonly store: RuntimeStore) {}

  async applyMutation(mutation: BlocklistMutation): Promise<void> {
    await this.store.applyGuildEmojiMutation(mutation);
  }

  async getGuildBlocklist(guildId: string): Promise<{ enabled: boolean; emojis: string[] }> {
    const config = await this.store.readConfig();
    return config.guilds?.[guildId] ?? { enabled: true, emojis: [] };
  }
}
