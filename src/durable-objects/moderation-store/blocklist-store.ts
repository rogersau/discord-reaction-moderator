import type { AppConfigRow, BlocklistConfig, GuildBlockedEmojiRow, GuildSettingRow } from "../../types";
import { buildBlocklistConfig } from "../../blocklist";

export function readConfig(sql: DurableObjectStorage["sql"]): BlocklistConfig {
  const guildRows: GuildSettingRow[] = [
    ...sql.exec("SELECT guild_id, moderation_enabled FROM guild_settings"),
  ].map((row) => ({
    guild_id: row.guild_id as string,
    moderation_enabled: row.moderation_enabled as number,
  }));
  const guildEmojiRows: GuildBlockedEmojiRow[] = [
    ...sql.exec(
      "SELECT guild_id, normalized_emoji FROM guild_blocked_emojis"
    ),
  ].map((row) => ({
    guild_id: row.guild_id as string,
    normalized_emoji: row.normalized_emoji as string,
  }));
  const appConfigRows: AppConfigRow[] = [
    ...sql.exec("SELECT key, value FROM app_config"),
  ].map((row) => ({
    key: row.key as string,
    value: row.value as string,
  }));

  return buildBlocklistConfig(guildRows, guildEmojiRows, appConfigRows);
}

export function applyGuildEmojiMutation(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; emoji: string; action: "add" | "remove" }
): BlocklistConfig {
  if (body.action === "add") {
    sql.exec(
      "INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, ?)",
      body.guildId,
      1
    );
    sql.exec(
      "INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)",
      body.guildId,
      body.emoji
    );
  } else {
    sql.exec(
      "DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?",
      body.guildId,
      body.emoji
    );
  }

  return readConfig(sql);
}

export function readGuildNotificationChannel(
  sql: DurableObjectStorage["sql"],
  guildId: string
): string | null {
  const [row] = [...sql.exec(
    "SELECT notification_channel_id FROM guild_notification_channels WHERE guild_id = ?",
    guildId
  )];

  return typeof row?.notification_channel_id === "string"
    ? (row.notification_channel_id as string)
    : null;
}

export function upsertGuildNotificationChannel(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; notificationChannelId: string | null }
): void {
  if (body.notificationChannelId === null) {
    sql.exec(
      "DELETE FROM guild_notification_channels WHERE guild_id = ?",
      body.guildId
    );
    return;
  }

  sql.exec(
    "INSERT INTO guild_notification_channels(guild_id, notification_channel_id) VALUES(?, ?) ON CONFLICT(guild_id) DO UPDATE SET notification_channel_id = excluded.notification_channel_id",
    body.guildId,
    body.notificationChannelId
  );
}
