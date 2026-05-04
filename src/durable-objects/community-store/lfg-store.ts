import type { LfgConfig, LfgPost } from "../../types";

const DEFAULT_SERVER_OPTIONS = [
  { id: "namalsk", label: "Namalsk", emoji: "🧊" },
  { id: "chernarus", label: "Chernarus", emoji: "🌲" },
  { id: "both", label: "Both", emoji: "🔁" },
];

export function defaultLfgConfig(guildId: string): LfgConfig {
  return {
    guildId,
    noticeChannelId: null,
    noticeMessageId: null,
    serverOptions: DEFAULT_SERVER_OPTIONS,
    updatedAtMs: Date.now(),
  };
}

export function readLfgConfig(
  sql: DurableObjectStorage["sql"],
  guildId: string,
): LfgConfig | null {
  const row = [
    ...sql.exec(
      "SELECT guild_id, notice_channel_id, notice_message_id, server_options_json, updated_at_ms FROM lfg_configs WHERE guild_id = ?",
      guildId,
    ),
  ][0] as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    guildId: row.guild_id as string,
    noticeChannelId: row.notice_channel_id as string | null,
    noticeMessageId: row.notice_message_id as string | null,
    serverOptions: JSON.parse(row.server_options_json as string) as LfgConfig["serverOptions"],
    updatedAtMs: row.updated_at_ms as number,
  };
}

export function upsertLfgConfig(
  sql: DurableObjectStorage["sql"],
  config: LfgConfig,
): void {
  sql.exec(
    "INSERT INTO lfg_configs(guild_id, notice_channel_id, notice_message_id, server_options_json, updated_at_ms) VALUES(?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET notice_channel_id = excluded.notice_channel_id, notice_message_id = excluded.notice_message_id, server_options_json = excluded.server_options_json, updated_at_ms = excluded.updated_at_ms",
    config.guildId,
    config.noticeChannelId,
    config.noticeMessageId,
    JSON.stringify(config.serverOptions),
    config.updatedAtMs,
  );
}

export function listLfgPosts(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  options: { activeOnly?: boolean; limit?: number } = {},
): LfgPost[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.activeOnly
    ? sql.exec(
        "SELECT * FROM lfg_posts WHERE guild_id = ? AND active = 1 ORDER BY created_at_ms DESC LIMIT ?",
        guildId,
        limit,
      )
    : sql.exec(
        "SELECT * FROM lfg_posts WHERE guild_id = ? ORDER BY created_at_ms DESC LIMIT ?",
        guildId,
        limit,
      );

  return [...rows].map(rowToPost);
}

export function readLfgPost(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  postId: string,
): LfgPost | null {
  const row = [
    ...sql.exec(
      "SELECT * FROM lfg_posts WHERE guild_id = ? AND post_id = ?",
      guildId,
      postId,
    ),
  ][0] as Record<string, unknown> | undefined;

  return row ? rowToPost(row) : null;
}

export function readActiveLfgPostByOwner(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  ownerId: string,
): LfgPost | null {
  const row = [
    ...sql.exec(
      "SELECT * FROM lfg_posts WHERE guild_id = ? AND owner_id = ? AND active = 1 ORDER BY created_at_ms DESC LIMIT 1",
      guildId,
      ownerId,
    ),
  ][0] as Record<string, unknown> | undefined;

  return row ? rowToPost(row) : null;
}

export function createLfgPost(
  sql: DurableObjectStorage["sql"],
  post: LfgPost,
): void {
  sql.exec(
    "INSERT INTO lfg_posts(guild_id, post_id, owner_id, owner_display_name, server_id, server_label, when_play, looking_for, extra_info, channel_id, message_id, active, created_at_ms, closed_at_ms, closed_by_user_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    post.guildId,
    post.id,
    post.ownerId,
    post.ownerDisplayName,
    post.serverId,
    post.serverLabel,
    post.whenPlay,
    post.lookingFor,
    post.extraInfo,
    post.channelId,
    post.messageId,
    post.active ? 1 : 0,
    post.createdAtMs,
    post.closedAtMs,
    post.closedByUserId,
  );
}

export function updateLfgPostMessage(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; postId: string; messageId: string },
): void {
  sql.exec(
    "UPDATE lfg_posts SET message_id = ? WHERE guild_id = ? AND post_id = ?",
    body.messageId,
    body.guildId,
    body.postId,
  );
}

export function closeLfgPost(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; postId: string; closedByUserId: string; closedAtMs: number },
): LfgPost {
  const post = readLfgPost(sql, body.guildId, body.postId);
  if (!post || !post.active) {
    throw new Error("LFG post is already closed or missing");
  }

  sql.exec(
    "UPDATE lfg_posts SET active = 0, closed_at_ms = ?, closed_by_user_id = ? WHERE guild_id = ? AND post_id = ? AND active = 1",
    body.closedAtMs,
    body.closedByUserId,
    body.guildId,
    body.postId,
  );

  return {
    ...post,
    active: false,
    closedAtMs: body.closedAtMs,
    closedByUserId: body.closedByUserId,
  };
}

function rowToPost(row: Record<string, unknown>): LfgPost {
  return {
    guildId: row.guild_id as string,
    id: row.post_id as string,
    ownerId: row.owner_id as string,
    ownerDisplayName: row.owner_display_name as string,
    serverId: row.server_id as string,
    serverLabel: row.server_label as string,
    whenPlay: row.when_play as string,
    lookingFor: row.looking_for as string,
    extraInfo: row.extra_info as string,
    channelId: row.channel_id as string,
    messageId: row.message_id as string | null,
    active: row.active === 1,
    createdAtMs: row.created_at_ms as number,
    closedAtMs: row.closed_at_ms as number | null,
    closedByUserId: row.closed_by_user_id as string | null,
  };
}
