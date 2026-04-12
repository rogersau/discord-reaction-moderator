// Blocklist management via Cloudflare KV

import { DEFAULT_BLOCKLIST, type BlocklistConfig } from "./types";

const BLOCKLIST_KEY = "blocklist_config";

/**
 * Get the blocklist config from KV, or return defaults if not set.
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
 * Update the blocklist config in KV.
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

  if (!config.emojis.includes(emoji)) {
    config.emojis.push(emoji);
    await setBlocklist(kv, config);
  }

  return config;
}

/**
 * Remove an emoji from the global blocklist.
 */
export async function removeBlockedEmoji(
  kv: KVNamespace,
  emoji: string
): Promise<BlocklistConfig> {
  const config = await getBlocklist(kv);

  config.emojis = config.emojis.filter((e) => e !== emoji);
  await setBlocklist(kv, config);

  return config;
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
