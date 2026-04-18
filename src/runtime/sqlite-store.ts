import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import type {
  AppConfigRow,
  BlocklistConfig,
  GuildBlockedEmojiRow,
  GuildSettingRow,
  TicketInstance,
  TicketPanelConfig,
  TimedRoleAssignment,
} from "../types";
import type { ClosableRuntimeStore, GatewaySnapshot } from "./contracts";
import type { AppConfigMutation } from "./admin-types";
import { buildBlocklistConfig } from "../blocklist";

export interface SqliteRuntimeStoreOptions {
  sqlitePath: string;
  botUserId: string;
}

interface GatewaySessionRow {
  status: string;
  session_id: string | null;
  resume_gateway_url: string | null;
  last_sequence: number | null;
  backoff_attempt: number;
  last_error: string | null;
  heartbeat_interval_ms: number | null;
}

interface TimedRoleRowPartial {
  guild_id: string;
  user_id: string;
  role_id: string;
  duration_input: string;
  expires_at_ms: number;
}

interface TicketPanelRow {
  guild_id: string;
  panel_channel_id: string;
  category_channel_id: string;
  transcript_channel_id: string;
  panel_message_id: string | null;
  ticket_types_json: string;
}

interface TicketInstanceRow {
  guild_id: string;
  channel_id: string;
  ticket_type_id: string;
  ticket_type_label: string;
  opener_user_id: string;
  support_role_id: string | null;
  status: "open" | "closed";
  answers_json: string;
  opened_at_ms: number;
  closed_at_ms: number | null;
  closed_by_user_id: string | null;
  transcript_message_id: string | null;
}

export function createSqliteRuntimeStore(
  options: SqliteRuntimeStoreOptions
): ClosableRuntimeStore {
  mkdirSync(dirname(options.sqlitePath), { recursive: true });
  const db = new Database(options.sqlitePath);
  let closed = false;
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      moderation_enabled INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS guild_blocked_emojis (
      guild_id TEXT NOT NULL,
      normalized_emoji TEXT NOT NULL,
      PRIMARY KEY (guild_id, normalized_emoji)
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
    CREATE TABLE IF NOT EXISTS gateway_session (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL,
      session_id TEXT,
      resume_gateway_url TEXT,
      last_sequence INTEGER,
      backoff_attempt INTEGER NOT NULL,
      last_error TEXT,
      heartbeat_interval_ms INTEGER
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
  `);

  const insertBotUserId = db.prepare(
    "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)"
  );
  insertBotUserId.run("bot_user_id", options.botUserId);

  const selectGuildSettings = db.prepare("SELECT guild_id, moderation_enabled FROM guild_settings");
  const selectGuildBlockedEmojis = db.prepare("SELECT guild_id, normalized_emoji FROM guild_blocked_emojis");
  const selectAppConfig = db.prepare("SELECT key, value FROM app_config");

  const insertGuildSetting = db.prepare("INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, ?)");
  const insertGuildBlockedEmoji = db.prepare("INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)");
  const deleteGuildBlockedEmoji = db.prepare("DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?");
  const upsertAppConfigStmt = db.prepare(`
    INSERT INTO app_config(key, value)
    VALUES(?, ?)
    ON CONFLICT(key)
    DO UPDATE SET value = excluded.value
  `);

  const selectTimedRolesByGuild = db.prepare(
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC"
  );
  const selectTimedRoles = db.prepare(
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms FROM timed_roles ORDER BY guild_id ASC, expires_at_ms ASC"
  );
  const selectTicketPanel = db.prepare(
    "SELECT guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json FROM ticket_panels WHERE guild_id = ?"
  );
  const upsertTicketPanel = db.prepare(`
    INSERT INTO ticket_panels(guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json)
    VALUES(?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id)
    DO UPDATE SET
      panel_channel_id = excluded.panel_channel_id,
      category_channel_id = excluded.category_channel_id,
      transcript_channel_id = excluded.transcript_channel_id,
      panel_message_id = excluded.panel_message_id,
      ticket_types_json = excluded.ticket_types_json
  `);
  const insertTicketInstance = db.prepare(`
    INSERT INTO ticket_instances(
      guild_id,
      channel_id,
      ticket_type_id,
      ticket_type_label,
      opener_user_id,
      support_role_id,
      status,
      answers_json,
      opened_at_ms,
      closed_at_ms,
      closed_by_user_id,
      transcript_message_id
    )
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectOpenTicketByChannel = db.prepare(`
    SELECT guild_id, channel_id, ticket_type_id, ticket_type_label, opener_user_id, support_role_id, status, answers_json, opened_at_ms, closed_at_ms, closed_by_user_id, transcript_message_id
    FROM ticket_instances
    WHERE guild_id = ? AND channel_id = ? AND status = 'open'
  `);
  const deleteTicketInstanceStmt = db.prepare(
    "DELETE FROM ticket_instances WHERE guild_id = ? AND channel_id = ?"
  );
  const closeTicketInstanceStmt = db.prepare(`
    UPDATE ticket_instances
    SET status = 'closed',
        closed_by_user_id = ?,
        closed_at_ms = ?,
        transcript_message_id = ?
    WHERE guild_id = ? AND channel_id = ? AND status = 'open'
  `);
  const upsertTimedRoleStmt = db.prepare(`
    INSERT INTO timed_roles(guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms)
    VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, role_id)
    DO UPDATE SET
      duration_input = excluded.duration_input,
      expires_at_ms = excluded.expires_at_ms,
      updated_at_ms = excluded.updated_at_ms
  `);
  const deleteTimedRoleStmt = db.prepare("DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?");
  const selectExpiredTimedRoles = db.prepare(
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms FROM timed_roles WHERE expires_at_ms <= ? ORDER BY expires_at_ms ASC"
  );

  const selectGatewaySnapshot = db.prepare("SELECT * FROM gateway_session WHERE id = 1");
  const upsertGatewaySnapshot = db.prepare(`
    INSERT INTO gateway_session(id, status, session_id, resume_gateway_url, last_sequence, backoff_attempt, last_error, heartbeat_interval_ms)
    VALUES(1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id)
    DO UPDATE SET
      status = excluded.status,
      session_id = excluded.session_id,
      resume_gateway_url = excluded.resume_gateway_url,
      last_sequence = excluded.last_sequence,
      backoff_attempt = excluded.backoff_attempt,
      last_error = excluded.last_error,
      heartbeat_interval_ms = excluded.heartbeat_interval_ms
  `);

  return {
    async readConfig(): Promise<BlocklistConfig> {
      const guildRows = selectGuildSettings.all() as GuildSettingRow[];
      const guildEmojiRows = selectGuildBlockedEmojis.all() as GuildBlockedEmojiRow[];
      const appConfigRows = selectAppConfig.all() as AppConfigRow[];

      return buildBlocklistConfig(guildRows, guildEmojiRows, appConfigRows);
    },

    async upsertAppConfig(body: AppConfigMutation): Promise<void> {
      upsertAppConfigStmt.run(body.key, body.value);
    },

    async applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig> {
      if (body.action === "add") {
        const addEmoji = db.transaction(() => {
          insertGuildSetting.run(body.guildId, 1);
          insertGuildBlockedEmoji.run(body.guildId, body.emoji);
        });
        addEmoji();
      } else {
        deleteGuildBlockedEmoji.run(body.guildId, body.emoji);
      }

      return this.readConfig();
    },

    async readTicketPanelConfig(guildId: string): Promise<TicketPanelConfig | null> {
      const row = selectTicketPanel.get(guildId) as TicketPanelRow | undefined;
      if (!row) {
        return null;
      }

      return {
        guildId: row.guild_id,
        panelChannelId: row.panel_channel_id,
        categoryChannelId: row.category_channel_id,
        transcriptChannelId: row.transcript_channel_id,
        panelMessageId: row.panel_message_id,
        ticketTypes: JSON.parse(row.ticket_types_json) as TicketPanelConfig["ticketTypes"],
      };
    },

    async upsertTicketPanelConfig(panel: TicketPanelConfig): Promise<void> {
      upsertTicketPanel.run(
        panel.guildId,
        panel.panelChannelId,
        panel.categoryChannelId,
        panel.transcriptChannelId,
        panel.panelMessageId,
        JSON.stringify(panel.ticketTypes)
      );
    },

    async createTicketInstance(instance: TicketInstance): Promise<void> {
      insertTicketInstance.run(
        instance.guildId,
        instance.channelId,
        instance.ticketTypeId,
        instance.ticketTypeLabel,
        instance.openerUserId,
        instance.supportRoleId,
        instance.status,
        JSON.stringify(instance.answers),
        instance.openedAtMs,
        instance.closedAtMs,
        instance.closedByUserId,
        instance.transcriptMessageId
      );
    },

    async deleteTicketInstance(body: { guildId: string; channelId: string }): Promise<void> {
      deleteTicketInstanceStmt.run(body.guildId, body.channelId);
    },

    async readOpenTicketByChannel(guildId: string, channelId: string): Promise<TicketInstance | null> {
      const row = selectOpenTicketByChannel.get(guildId, channelId) as TicketInstanceRow | undefined;
      if (!row) {
        return null;
      }

      return {
        guildId: row.guild_id,
        channelId: row.channel_id,
        ticketTypeId: row.ticket_type_id,
        ticketTypeLabel: row.ticket_type_label,
        openerUserId: row.opener_user_id,
        supportRoleId: row.support_role_id,
        status: row.status,
        answers: JSON.parse(row.answers_json) as TicketInstance["answers"],
        openedAtMs: row.opened_at_ms,
        closedAtMs: row.closed_at_ms,
        closedByUserId: row.closed_by_user_id,
        transcriptMessageId: row.transcript_message_id,
      };
    },

    async closeTicketInstance(body: {
      guildId: string;
      channelId: string;
      closedByUserId: string;
      closedAtMs: number;
      transcriptMessageId: string | null;
    }): Promise<void> {
      const result = closeTicketInstanceStmt.run(
        body.closedByUserId,
        body.closedAtMs,
        body.transcriptMessageId,
        body.guildId,
        body.channelId
      );

      if (result.changes === 0) {
        throw new Error(`No open ticket found for guild ${body.guildId} channel ${body.channelId}`);
      }
    },

    async listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]> {
      const rows = selectTimedRolesByGuild.all(guildId) as TimedRoleRowPartial[];

      return rows.map((row) => ({
        guildId: row.guild_id,
        userId: row.user_id,
        roleId: row.role_id,
        durationInput: row.duration_input,
        expiresAtMs: row.expires_at_ms,
      }));
    },

    async listTimedRoles(): Promise<TimedRoleAssignment[]> {
      const rows = selectTimedRoles.all() as TimedRoleRowPartial[];

      return rows.map((row) => ({
        guildId: row.guild_id,
        userId: row.user_id,
        roleId: row.role_id,
        durationInput: row.duration_input,
        expiresAtMs: row.expires_at_ms,
      }));
    },

    async upsertTimedRole(body: TimedRoleAssignment): Promise<void> {
      const now = Date.now();
      upsertTimedRoleStmt.run(
        body.guildId,
        body.userId,
        body.roleId,
        body.durationInput,
        body.expiresAtMs,
        now,
        now
      );
    },

    async deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void> {
      deleteTimedRoleStmt.run(body.guildId, body.userId, body.roleId);
    },

    async listExpiredTimedRoles(nowMs: number): Promise<TimedRoleAssignment[]> {
      const rows = selectExpiredTimedRoles.all(nowMs) as TimedRoleRowPartial[];

      return rows.map((row) => ({
        guildId: row.guild_id,
        userId: row.user_id,
        roleId: row.role_id,
        durationInput: row.duration_input,
        expiresAtMs: row.expires_at_ms,
      }));
    },

    async readGatewaySnapshot(): Promise<GatewaySnapshot> {
      const row = selectGatewaySnapshot.get() as GatewaySessionRow | undefined;

      if (!row) {
        return {
          status: "idle",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        };
      }

      return {
        status: row.status as GatewaySnapshot["status"],
        sessionId: row.session_id,
        resumeGatewayUrl: row.resume_gateway_url,
        lastSequence: row.last_sequence,
        backoffAttempt: row.backoff_attempt,
        lastError: row.last_error,
        heartbeatIntervalMs: row.heartbeat_interval_ms,
      };
    },

    async writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void> {
      upsertGatewaySnapshot.run(
        snapshot.status,
        snapshot.sessionId,
        snapshot.resumeGatewayUrl,
        snapshot.lastSequence,
        snapshot.backoffAttempt,
        snapshot.lastError,
        snapshot.heartbeatIntervalMs
      );
    },
    close(): void {
      if (closed) {
        return;
      }
      db.close();
      closed = true;
    },
  };
}
