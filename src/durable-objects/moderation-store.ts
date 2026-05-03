import type { Env } from "../env";
import { removeGuildMemberRole } from "../discord";
import { createChannelMessage } from "../discord/messages";
import {
  ModerationStoreInputError,
  parseGuildEmojiMutation,
  parseGuildNotificationChannelMutation,
  parseTimedRoleUpsert,
  parseTimedRoleRemoval,
  parseNewMemberTimedRoleConfig,
  parseAppConfigMutation,
  parseGuildIdRequest,
  parseTicketPanelConfig,
  parseTicketInstance,
  parseTicketDeleteRequest,
  parseTicketCloseRequest,
  parseMarketplaceConfig,
  parseMarketplaceLog,
  parseMarketplacePost,
  parseMarketplacePostClose,
  parseMarketplacePostMessage,
  asRequiredSearchParam,
} from "./moderation-store/request-parsers";
import * as blocklistStore from "./moderation-store/blocklist-store";
import * as appConfigStore from "./moderation-store/app-config-store";
import * as timedRoleStore from "./moderation-store/timed-role-store";
import * as ticketStore from "./moderation-store/ticket-store";
import * as marketplaceStore from "./moderation-store/marketplace-store";
import { buildTimedRoleUpdateMessage } from "../services/moderation-log";

export class ModerationStoreDO implements DurableObject {
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
    `);

    this.sql.exec(
      "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)",
      "bot_user_id",
      env.BOT_USER_ID,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/config") {
      try {
        return Response.json(blocklistStore.readConfig(this.sql));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/guild-emoji") {
      try {
        const body = parseGuildEmojiMutation(await request.json());
        return Response.json(blocklistStore.applyGuildEmojiMutation(this.sql, body));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/guild-notification-channel") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        return Response.json({
          notificationChannelId: blocklistStore.readGuildNotificationChannel(this.sql, guildId),
        });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/guild-notification-channel") {
      try {
        const body = parseGuildNotificationChannelMutation(await request.json());
        blocklistStore.upsertGuildNotificationChannel(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/timed-role") {
      try {
        const body = parseTimedRoleUpsert(await request.json());
        timedRoleStore.upsertTimedRole(this.sql, body);
        await this.scheduleNextTimedRoleAlarm();
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/timed-role/remove") {
      try {
        const body = parseTimedRoleRemoval(await request.json());
        timedRoleStore.deleteTimedRole(this.sql, body);
        await this.scheduleNextTimedRoleAlarm();
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/timed-roles") {
      try {
        const guildId = url.searchParams.get("guildId");
        return Response.json(
          guildId
            ? timedRoleStore.listTimedRolesByGuild(this.sql, guildId)
            : timedRoleStore.listTimedRoles(this.sql),
        );
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/timed-role/new-member-config") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        return Response.json(timedRoleStore.readNewMemberTimedRoleConfig(this.sql, guildId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/timed-role/new-member-config") {
      try {
        const body = parseNewMemberTimedRoleConfig(await request.json());
        timedRoleStore.upsertNewMemberTimedRoleConfig(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/app-config") {
      try {
        const body = parseAppConfigMutation(await request.json());
        return Response.json(appConfigStore.upsertAppConfig(this.sql, body));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-number/next") {
      try {
        const body = parseGuildIdRequest(await request.json());
        return Response.json({
          ticketNumber: ticketStore.reserveNextTicketNumber(this.sql, body.guildId),
        });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/ticket-panel") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        return Response.json(ticketStore.readTicketPanelConfig(this.sql, guildId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-panel") {
      try {
        const body = parseTicketPanelConfig(await request.json());
        ticketStore.upsertTicketPanelConfig(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance") {
      try {
        const body = parseTicketInstance(await request.json());
        ticketStore.createTicketInstance(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/ticket-instance/open") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const channelId = asRequiredSearchParam(url.searchParams, "channelId");
        return Response.json(ticketStore.readOpenTicketByChannel(this.sql, guildId, channelId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance/delete") {
      try {
        const body = parseTicketDeleteRequest(await request.json());
        ticketStore.deleteTicketInstance(this.sql, body.guildId, body.channelId);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance/close") {
      try {
        const body = parseTicketCloseRequest(await request.json());
        ticketStore.closeTicketInstance(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/marketplace/config") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        return Response.json(
          marketplaceStore.readMarketplaceConfig(this.sql, guildId) ??
            marketplaceStore.defaultMarketplaceConfig(guildId),
        );
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/marketplace/config") {
      try {
        const body = parseMarketplaceConfig(await request.json());
        marketplaceStore.upsertMarketplaceConfig(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/marketplace/posts") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const activeOnly = url.searchParams.get("activeOnly") === "1";
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
        return Response.json(
          marketplaceStore.listMarketplacePosts(this.sql, guildId, { activeOnly, limit }),
        );
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/marketplace/post") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const postId = asRequiredSearchParam(url.searchParams, "postId");
        return Response.json(marketplaceStore.readMarketplacePost(this.sql, guildId, postId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/marketplace/post/active-by-owner") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const ownerId = asRequiredSearchParam(url.searchParams, "ownerId");
        return Response.json(
          marketplaceStore.readActiveMarketplacePostByOwner(this.sql, guildId, ownerId),
        );
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/marketplace/post") {
      try {
        const body = parseMarketplacePost(await request.json());
        marketplaceStore.createMarketplacePost(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/marketplace/post/message") {
      try {
        const body = parseMarketplacePostMessage(await request.json());
        marketplaceStore.updateMarketplacePostMessage(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/marketplace/post/close") {
      try {
        const body = parseMarketplacePostClose(await request.json());
        return Response.json(marketplaceStore.closeMarketplacePost(this.sql, body));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/marketplace/logs") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
        return Response.json(marketplaceStore.listMarketplaceLogs(this.sql, guildId, limit));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/marketplace/log") {
      try {
        const body = parseMarketplaceLog(await request.json());
        marketplaceStore.createMarketplaceLog(this.sql, body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

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
        await this.postGuildModerationUpdate(
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

  private async postGuildModerationUpdate(
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
      console.error("Failed to post moderation update", error);
    }
  }

  private errorResponse(error: unknown): Response {
    if (error instanceof SyntaxError || error instanceof ModerationStoreInputError) {
      return Response.json({ error: error.message || "Invalid JSON body" }, { status: 400 });
    }

    console.error("Moderation store request failed", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
