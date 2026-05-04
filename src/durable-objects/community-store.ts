import type { Env } from "../env";
import { removeGuildMemberRole } from "../discord";
import { createChannelMessage } from "../discord/messages";
import * as blocklistStore from "./community-store/blocklist-store";
import * as timedRoleStore from "./community-store/timed-role-store";
import { buildTimedRoleUpdateMessage } from "../services/activity-log";
import { routeBlocklist } from "./community-store/routes/blocklist";
import { routeTimedRole } from "./community-store/routes/timed-roles";
import { routeTicket } from "./community-store/routes/tickets";
import { routeMarketplace } from "./community-store/routes/marketplace";
import { routeLfg } from "./community-store/routes/lfg";

export class CommunityStoreDO implements DurableObject {
  private readonly ctx: DurableObjectState;
  private readonly env: Env;
  private readonly sql: DurableObjectStorage["sql"];

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS guild_settings (
        guild_id TEXT PRIMARY KEY,
        moderation_enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS guild_blocked_emojis (
        guild_id TEXT NOT NULL,
        normalized_emoji TEXT NOT NULL,
        PRIMARY KEY (guild_id, normalized_emoji)
      );
      CREATE TABLE IF NOT EXISTS guild_notification_channels (
        guild_id TEXT PRIMARY KEY,
        notification_channel_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS app_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timed_roles (
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role_id TEXT NOT NULL,
        duration_input TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (guild_id, user_id, role_id)
      );
      CREATE TABLE IF NOT EXISTS new_member_timed_role_configs (
        guild_id TEXT PRIMARY KEY,
        role_id TEXT NOT NULL,
        duration_input TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_panels (
        guild_id TEXT PRIMARY KEY,
        panel_channel_id TEXT NOT NULL,
        category_channel_id TEXT NOT NULL,
        transcript_channel_id TEXT NOT NULL,
        panel_message_id TEXT,
        ticket_types_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ticket_instances (
        guild_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        ticket_type_id TEXT NOT NULL,
        ticket_type_label TEXT NOT NULL,
        opener_user_id TEXT NOT NULL,
        support_role_id TEXT,
        status TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        opened_at_ms INTEGER NOT NULL,
        closed_at_ms INTEGER,
        closed_by_user_id TEXT,
        transcript_message_id TEXT,
        PRIMARY KEY (guild_id, channel_id)
      );
      CREATE TABLE IF NOT EXISTS ticket_counters (
        guild_id TEXT PRIMARY KEY,
        next_ticket_number INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS marketplace_configs (
        guild_id TEXT PRIMARY KEY,
        notice_channel_id TEXT,
        notice_message_id TEXT,
        log_channel_id TEXT,
        server_options_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS marketplace_posts (
        guild_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_display_name TEXT NOT NULL,
        trade_type TEXT NOT NULL,
        server_id TEXT NOT NULL,
        server_label TEXT NOT NULL,
        have TEXT NOT NULL,
        want TEXT NOT NULL,
        extra TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        active INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        closed_at_ms INTEGER,
        closed_by_user_id TEXT,
        PRIMARY KEY (guild_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS marketplace_posts_by_owner_active ON marketplace_posts(guild_id, owner_id, active);
      CREATE TABLE IF NOT EXISTS marketplace_trade_logs (
        guild_id TEXT NOT NULL,
        log_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        buyer_id TEXT NOT NULL,
        buyer_display_name TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        trade_type TEXT NOT NULL,
        server_label TEXT NOT NULL,
        dm_sent INTEGER NOT NULL,
        dm_error TEXT,
        have TEXT NOT NULL,
        want TEXT NOT NULL,
        PRIMARY KEY (guild_id, log_id)
      );
      CREATE INDEX IF NOT EXISTS marketplace_logs_by_timestamp ON marketplace_trade_logs(guild_id, timestamp_ms DESC);
      CREATE TABLE IF NOT EXISTS lfg_configs (
        guild_id TEXT PRIMARY KEY,
        notice_channel_id TEXT,
        notice_message_id TEXT,
        server_options_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lfg_posts (
        guild_id TEXT NOT NULL,
        post_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        owner_display_name TEXT NOT NULL,
        server_id TEXT NOT NULL,
        server_label TEXT NOT NULL,
        when_play TEXT NOT NULL,
        looking_for TEXT NOT NULL,
        extra_info TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        message_id TEXT,
        active INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL,
        closed_at_ms INTEGER,
        closed_by_user_id TEXT,
        PRIMARY KEY (guild_id, post_id)
      );
      CREATE INDEX IF NOT EXISTS lfg_posts_by_owner_active ON lfg_posts(guild_id, owner_id, active);
    `);

    this.sql.exec(
      "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)",
      "bot_user_id",
      env.BOT_USER_ID,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const blocklistResponse = await routeBlocklist(this.sql, request);
    if (blocklistResponse) return blocklistResponse;

    if (url.pathname.startsWith("/timed-role") || url.pathname === "/timed-roles") {
      const response = await routeTimedRole(this.sql, request);
      if (response) {
        if (
          request.method === "POST" &&
          (url.pathname === "/timed-role" || url.pathname === "/timed-role/remove")
        ) {
          try {
            await this.scheduleNextTimedRoleAlarm();
          } catch {
            // Alarm scheduling failure is non-fatal
          }
        }
        return response;
      }
    }

    const ticketResponse = await routeTicket(this.sql, request);
    if (ticketResponse) return ticketResponse;

    const marketplaceResponse = await routeMarketplace(this.sql, request);
    if (marketplaceResponse) return marketplaceResponse;

    const lfgResponse = await routeLfg(this.sql, request);
    if (lfgResponse) return lfgResponse;

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const expiredRows = timedRoleStore.listExpiredTimedRoles(this.sql, Date.now());

    for (const row of expiredRows) {
      try {
        await removeGuildMemberRole(
          row.guildId,
          row.userId,
          row.roleId,
          this.env.DISCORD_BOT_TOKEN,
        );
        timedRoleStore.deleteTimedRole(this.sql, {
          guildId: row.guildId,
          userId: row.userId,
          roleId: row.roleId,
        });
        await this.postGuildActivityUpdate(
          row.guildId,
          buildTimedRoleUpdateMessage({
            action: "expire",
            userId: row.userId,
            roleId: row.roleId,
          }),
        );
      } catch (error) {
        console.error("Failed to remove expired timed role", error);
      }
    }

    await this.scheduleNextTimedRoleAlarm();
  }

  private async scheduleNextTimedRoleAlarm(): Promise<void> {
    const nextExpiryMs = timedRoleStore.getNextTimedRoleExpiryMs(this.sql);

    if (!nextExpiryMs) {
      await this.clearTimedRoleAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(nextExpiryMs);
  }

  private async clearTimedRoleAlarm(): Promise<void> {
    const storageWithDeleteAlarm = this.ctx.storage as DurableObjectStorage & {
      deleteAlarm?: () => Promise<void>;
    };

    if (typeof storageWithDeleteAlarm.deleteAlarm === "function") {
      await storageWithDeleteAlarm.deleteAlarm();
    }
  }

  private async postGuildActivityUpdate(
    guildId: string,
    body: Parameters<typeof createChannelMessage>[1],
  ): Promise<void> {
    try {
      const notificationChannelId = blocklistStore.readGuildNotificationChannel(this.sql, guildId);

      if (!notificationChannelId) {
        return;
      }

      await createChannelMessage(notificationChannelId, body, this.env.DISCORD_BOT_TOKEN);
    } catch (error) {
      console.error("Failed to post activity update", error);
    }
  }
}
