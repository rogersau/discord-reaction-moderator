import type { BlocklistStore } from "../../runtime/contracts/blocklist-store";

export async function getGuildBlocklist(
  store: Pick<BlocklistStore, "readConfig">,
  guildId: string
): Promise<{ enabled: boolean; emojis: string[] }> {
  const config = await store.readConfig();
  return config.guilds?.[guildId] ?? { enabled: true, emojis: [] };
}
