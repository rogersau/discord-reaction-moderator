import {
  listBotGuilds,
  listGuildEmojis,
  listGuildTicketResources,
  type DiscordGuildEmojiResource,
  type GuildTicketResources,
} from "../discord";
import { loadGuildPermissionContext, type GuildPermissionContext } from "./admin-permissions";

const ADMIN_DISCORD_CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry<T> {
  expiresAtMs: number;
  promise: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();

export function shouldRefreshAdminDiscordCache(url: URL): boolean {
  const refresh = url.searchParams.get("refresh");
  return refresh === "1" || refresh === "true";
}

export function getCachedBotGuilds(
  botToken: string,
  refresh: boolean,
): Promise<Array<{ guildId: string; name: string }>> {
  return readCached(`bot-guilds:${botToken}`, refresh, () => listBotGuilds(botToken));
}

export function getCachedGuildPermissionContext(
  guildId: string,
  botUserId: string,
  botToken: string,
  refresh: boolean,
): Promise<GuildPermissionContext> {
  return readCached(`guild-permissions:${botToken}:${botUserId}:${guildId}`, refresh, () =>
    loadGuildPermissionContext(guildId, botUserId, botToken),
  );
}

export function getCachedGuildTicketResources(
  guildId: string,
  botToken: string,
  refresh: boolean,
): Promise<GuildTicketResources> {
  return readCached(`ticket-resources:${botToken}:${guildId}`, refresh, () =>
    listGuildTicketResources(guildId, botToken),
  );
}

export function getCachedGuildEmojis(
  guildId: string,
  botToken: string,
  refresh: boolean,
): Promise<DiscordGuildEmojiResource[]> {
  return readCached(`guild-emojis:${botToken}:${guildId}`, refresh, () =>
    listGuildEmojis(guildId, botToken),
  );
}

function readCached<T>(key: string, refresh: boolean, load: () => Promise<T>): Promise<T> {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (!refresh && existing && existing.expiresAtMs > Date.now()) {
    return existing.promise;
  }

  const promise = load();
  cache.set(key, {
    expiresAtMs: Date.now() + ADMIN_DISCORD_CACHE_TTL_MS,
    promise,
  });
  return promise;
}
