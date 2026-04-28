import type { BlocklistStore } from "../runtime/contracts";
import { applyGuildEmojiMutation as applyGuildEmojiMutationWorkflow } from "./blocklist/apply-guild-emoji-mutation";
import { getGuildBlocklist as getGuildBlocklistWorkflow } from "./blocklist/get-guild-blocklist";

export interface BlocklistMutation {
  guildId: string;
  action: "add" | "remove";
  emoji: string;
}

export class BlocklistService {
  constructor(private readonly store: BlocklistStore) {}

  async applyMutation(mutation: BlocklistMutation): Promise<void> {
    await applyGuildEmojiMutationWorkflow(this.store, mutation);
  }

  async getGuildBlocklist(guildId: string): Promise<{ enabled: boolean; emojis: string[] }> {
    return getGuildBlocklistWorkflow(this.store, guildId);
  }
}
