import type { BlocklistStore } from "../../runtime/contracts/blocklist-store";

export interface BlocklistMutation {
  guildId: string;
  action: "add" | "remove";
  emoji: string;
}

export async function applyGuildEmojiMutation(
  store: Pick<BlocklistStore, "applyGuildEmojiMutation">,
  mutation: BlocklistMutation,
): Promise<void> {
  await store.applyGuildEmojiMutation(mutation);
}
