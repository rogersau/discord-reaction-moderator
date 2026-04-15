import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import Database from "better-sqlite3";
import type {
  AppConfigRow,
  BlocklistConfig,
  GuildBlockedEmojiRow,
  GuildSettingRow,
  TimedRoleAssignment,
} from "../types";
 import type { ClosableRuntimeStore, GatewaySnapshot } from "./contracts";
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

  const selectTimedRolesByGuild = db.prepare(
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC"
  );
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
