// Blocklist materialization helpers plus legacy KV compatibility utilities.

import type {
  AppConfigRow,
  BlocklistConfig,
  GlobalEmojiMutation,
  GlobalBlockedEmojiRow,
  GuildBlockedEmojiRow,
  GuildSettingRow,
} from "./types";
import { DEFAULT_BLOCKLIST } from "./types";
import type { KVNamespace } from "@cloudflare/workers-types";

const BLOCKLIST_KEY = "blocklist_config";

export function buildBlocklistConfig(
  globalRows: GlobalBlockedEmojiRow[],
  guildRows: GuildSettingRow[],
  guildEmojiRows: GuildBlockedEmojiRow[],
  appConfigRows: AppConfigRow[]
): BlocklistConfig {
  const guilds: BlocklistConfig["guilds"] = {};
  const botUserId =
    appConfigRows.find((row) => row.key === "bot_user_id")?.value ?? "";

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
    emojis: globalRows.map((row) => row.normalized_emoji),
    guilds,
    botUserId,
  };
}

export function applyEmojiMutation(
  config: BlocklistConfig,
  mutation: GlobalEmojiMutation
): BlocklistConfig {
  const next = {
    ...config,
    emojis: [...config.emojis],
    guilds: { ...config.guilds },
  };

  if (mutation.action === "add" && !next.emojis.includes(mutation.emoji)) {
    next.emojis.push(mutation.emoji);
  }

  if (mutation.action === "remove") {
    next.emojis = next.emojis.filter((emoji) => emoji !== mutation.emoji);
  }

  return next;
}

export async function getBlocklistFromStore(
  fetchConfig: () => Promise<Response>
): Promise<BlocklistConfig> {
  const response = await fetchConfig();

  if (!response.ok) {
    throw new Error(
      `Failed to load moderation config from store (${response.status})`
    );
  }

  return (await response.json()) as BlocklistConfig;
}

/**
 * Legacy KV helper kept for compatibility with older workflows.
 */
export async function getBlocklist(
  kv: KVNamespace
): Promise<BlocklistConfig> {
  const stored = await kv.get(BLOCKLIST_KEY, "json");

  if (!stored) {
    // Initialize with defaults
    await kv.put(BLOCKLIST_KEY, JSON.stringify(DEFAULT_BLOCKLIST));
    return { ...DEFAULT_BLOCKLIST };
  }

  return stored as BlocklistConfig;
}

/**
 * Legacy KV helper kept for compatibility with older workflows.
 */
export async function setBlocklist(
  kv: KVNamespace,
  config: BlocklistConfig
): Promise<void> {
  await kv.put(BLOCKLIST_KEY, JSON.stringify(config));
}

/**
 * Add an emoji to the global blocklist.
 */
export async function addBlockedEmoji(
  kv: KVNamespace,
  emoji: string
): Promise<BlocklistConfig> {
  const config = await getBlocklist(kv);
  const next = applyEmojiMutation(config, {
    scope: "global",
    action: "add",
    emoji,
  });

  if (next.emojis.length !== config.emojis.length) {
    await setBlocklist(kv, next);
  }

  return next;
}

/**
 * Remove an emoji from the global blocklist.
 */
export async function removeBlockedEmoji(
  kv: KVNamespace,
  emoji: string
): Promise<BlocklistConfig> {
  const config = await getBlocklist(kv);
  const next = applyEmojiMutation(config, {
    scope: "global",
    action: "remove",
    emoji,
  });

  await setBlocklist(kv, next);

  return next;
}

/**
 * Check if an emoji is in the blocklist (global or guild-specific).
 */
export function isEmojiBlocked(
  emoji: string,
  config: BlocklistConfig,
  guildId: string | undefined
): boolean {
  // Check global blocklist
  if (config.emojis.includes(emoji)) {
    return true;
  }

  // Check guild-specific blocklist
  if (guildId && config.guilds[guildId]) {
    const guildConfig = config.guilds[guildId];
    if (!guildConfig.enabled) {
      return false;  // Guild has moderation disabled
    }
    if (guildConfig.emojis.includes(emoji)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalize an emoji for comparison.
 * Handles both unicode emojis and custom emoji name:id format.
 */
export function normalizeEmoji(rawEmoji: string | null): string | null {
  if (!rawEmoji) return null;
  // Strip colons from custom emoji names if present
  return rawEmoji.replace(/^:/, "").replace(/:$/, "");
}
