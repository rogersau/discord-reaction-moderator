import type { AppConfigRow, BlocklistConfig, GuildBlockedEmojiRow, GuildSettingRow } from "./types";

export function buildBlocklistConfig(
  guildRows: GuildSettingRow[],
  guildEmojiRows: GuildBlockedEmojiRow[],
  appConfigRows: AppConfigRow[],
): BlocklistConfig {
  const guilds: BlocklistConfig["guilds"] = {};
  const botUserId = appConfigRows.find((row) => row.key === "bot_user_id")?.value ?? "";

  for (const row of guildRows) {
    guilds[row.guild_id] = {
      enabled: row.moderation_enabled === 1,
      emojis: [],
    };
  }

  for (const row of guildEmojiRows) {
    guilds[row.guild_id] ??= { enabled: true, emojis: [] };
    guilds[row.guild_id].emojis.push(row.normalized_emoji);
  }

  return {
    guilds,
    botUserId,
  };
}

export async function getBlocklistFromStore(
  fetchConfig: () => Promise<Response>,
): Promise<BlocklistConfig> {
  const response = await fetchConfig();

  if (!response.ok) {
    throw new Error(`Failed to load moderation config from store (${response.status})`);
  }

  return (await response.json()) as BlocklistConfig;
}

export function isEmojiBlocked(
  emoji: string,
  config: BlocklistConfig,
  guildId: string | undefined,
): boolean {
  if (guildId && config.guilds[guildId]) {
    const guildConfig = config.guilds[guildId];
    if (!guildConfig.enabled) {
      return false;
    }

    if (guildConfig.emojis.includes(emoji)) {
      return true;
    }
  }

  return false;
}

export function normalizeEmoji(rawEmoji: string | null): string | null {
  if (!rawEmoji) {
    return null;
  }

  return rawEmoji.replace(/^:/, "").replace(/:$/, "");
}
