import type { MarketplaceBusinessLog, MarketplaceConfig, MarketplacePost } from "../../types";

const DEFAULT_SERVER_OPTIONS = [
  { id: "namalsk", label: "Namalsk", emoji: "🧊" },
  { id: "chernarus", label: "Chernarus", emoji: "🌲" },
];

export function defaultMarketplaceConfig(guildId: string): MarketplaceConfig {
  return {
    guildId,
    noticeChannelId: null,
    noticeMessageId: null,
    logChannelId: null,
    serverOptions: DEFAULT_SERVER_OPTIONS,
    updatedAtMs: Date.now(),
  };
}

export function readMarketplaceConfig(
  sql: DurableObjectStorage["sql"],
  guildId: string,
): MarketplaceConfig | null {
  const row = [
    ...sql.exec(
      "SELECT guild_id, notice_channel_id, notice_message_id, log_channel_id, server_options_json, updated_at_ms FROM marketplace_configs WHERE guild_id = ?",
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
    logChannelId: row.log_channel_id as string | null,
    serverOptions: JSON.parse(
      row.server_options_json as string,
    ) as MarketplaceConfig["serverOptions"],
    updatedAtMs: row.updated_at_ms as number,
  };
}

export function upsertMarketplaceConfig(
  sql: DurableObjectStorage["sql"],
  config: MarketplaceConfig,
): void {
  sql.exec(
    "INSERT INTO marketplace_configs(guild_id, notice_channel_id, notice_message_id, log_channel_id, server_options_json, updated_at_ms) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET notice_channel_id = excluded.notice_channel_id, notice_message_id = excluded.notice_message_id, log_channel_id = excluded.log_channel_id, server_options_json = excluded.server_options_json, updated_at_ms = excluded.updated_at_ms",
    config.guildId,
    config.noticeChannelId,
    config.noticeMessageId,
    config.logChannelId,
    JSON.stringify(config.serverOptions),
    config.updatedAtMs,
  );
}

export function listMarketplacePosts(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  options: { activeOnly?: boolean; limit?: number } = {},
): MarketplacePost[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = options.activeOnly
    ? sql.exec(
        "SELECT * FROM marketplace_posts WHERE guild_id = ? AND active = 1 ORDER BY created_at_ms DESC LIMIT ?",
        guildId,
        limit,
      )
    : sql.exec(
        "SELECT * FROM marketplace_posts WHERE guild_id = ? ORDER BY created_at_ms DESC LIMIT ?",
        guildId,
        limit,
      );

  return [...rows].map(rowToPost);
}

export function readMarketplacePost(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  postId: string,
): MarketplacePost | null {
  const row = [
    ...sql.exec(
      "SELECT * FROM marketplace_posts WHERE guild_id = ? AND post_id = ?",
      guildId,
      postId,
    ),
  ][0] as Record<string, unknown> | undefined;

  return row ? rowToPost(row) : null;
}

export function readActiveMarketplacePostByOwner(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  ownerId: string,
): MarketplacePost | null {
  const row = [
    ...sql.exec(
      "SELECT * FROM marketplace_posts WHERE guild_id = ? AND owner_id = ? AND active = 1 ORDER BY created_at_ms DESC LIMIT 1",
      guildId,
      ownerId,
    ),
  ][0] as Record<string, unknown> | undefined;

  return row ? rowToPost(row) : null;
}

export function createMarketplacePost(
  sql: DurableObjectStorage["sql"],
  post: MarketplacePost,
): void {
  sql.exec(
    "INSERT INTO marketplace_posts(guild_id, post_id, owner_id, owner_display_name, trade_type, server_id, server_label, have, want, extra, channel_id, message_id, active, created_at_ms, closed_at_ms, closed_by_user_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    post.guildId,
    post.id,
    post.ownerId,
    post.ownerDisplayName,
    post.tradeType,
    post.serverId,
    post.serverLabel,
    post.have,
    post.want,
    post.extra,
    post.channelId,
    post.messageId,
    post.active ? 1 : 0,
    post.createdAtMs,
    post.closedAtMs,
    post.closedByUserId,
  );
}

export function updateMarketplacePostMessage(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; postId: string; messageId: string },
): void {
  sql.exec(
    "UPDATE marketplace_posts SET message_id = ? WHERE guild_id = ? AND post_id = ?",
    body.messageId,
    body.guildId,
    body.postId,
  );
}

export function closeMarketplacePost(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; postId: string; closedByUserId: string; closedAtMs: number },
): MarketplacePost {
  const post = readMarketplacePost(sql, body.guildId, body.postId);
  if (!post || !post.active) {
    throw new Error("Marketplace post is already closed or missing");
  }

  sql.exec(
    "UPDATE marketplace_posts SET active = 0, closed_at_ms = ?, closed_by_user_id = ? WHERE guild_id = ? AND post_id = ? AND active = 1",
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

export function listMarketplaceLogs(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  limit = 20,
): MarketplaceBusinessLog[] {
  return [
    ...sql.exec(
      "SELECT * FROM marketplace_trade_logs WHERE guild_id = ? ORDER BY timestamp_ms DESC LIMIT ?",
      guildId,
      Math.min(Math.max(limit, 1), 100),
    ),
  ].map(rowToLog);
}

export function createMarketplaceLog(
  sql: DurableObjectStorage["sql"],
  log: MarketplaceBusinessLog,
): void {
  sql.exec(
    "INSERT INTO marketplace_trade_logs(guild_id, log_id, timestamp_ms, buyer_id, buyer_display_name, seller_id, post_id, channel_id, message_id, trade_type, server_label, dm_sent, dm_error, have, want) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    log.guildId,
    log.id,
    log.timestampMs,
    log.buyerId,
    log.buyerDisplayName,
    log.sellerId,
    log.postId,
    log.channelId,
    log.messageId,
    log.tradeType,
    log.serverLabel,
    log.dmSent ? 1 : 0,
    log.dmError,
    log.have,
    log.want,
  );
  sql.exec(
    "DELETE FROM marketplace_trade_logs WHERE guild_id = ? AND log_id NOT IN (SELECT log_id FROM marketplace_trade_logs WHERE guild_id = ? ORDER BY timestamp_ms DESC LIMIT 1000)",
    log.guildId,
    log.guildId,
  );
}

function rowToPost(row: Record<string, unknown>): MarketplacePost {
  return {
    guildId: row.guild_id as string,
    id: row.post_id as string,
    ownerId: row.owner_id as string,
    ownerDisplayName: row.owner_display_name as string,
    tradeType: row.trade_type as MarketplacePost["tradeType"],
    serverId: row.server_id as string,
    serverLabel: row.server_label as string,
    have: row.have as string,
    want: row.want as string,
    extra: row.extra as string,
    channelId: row.channel_id as string,
    messageId: row.message_id as string | null,
    active: row.active === 1,
    createdAtMs: row.created_at_ms as number,
    closedAtMs: row.closed_at_ms as number | null,
    closedByUserId: row.closed_by_user_id as string | null,
  };
}

function rowToLog(row: Record<string, unknown>): MarketplaceBusinessLog {
  return {
    guildId: row.guild_id as string,
    id: row.log_id as string,
    timestampMs: row.timestamp_ms as number,
    buyerId: row.buyer_id as string,
    buyerDisplayName: row.buyer_display_name as string,
    sellerId: row.seller_id as string,
    postId: row.post_id as string,
    channelId: row.channel_id as string,
    messageId: row.message_id as string | null,
    tradeType: row.trade_type as MarketplaceBusinessLog["tradeType"],
    serverLabel: row.server_label as string,
    dmSent: row.dm_sent === 1,
    dmError: row.dm_error as string | null,
    have: row.have as string,
    want: row.want as string,
  };
}
