import type {
  AppConfigRow,
  BlocklistConfig,
  GuildBlockedEmojiRow,
  GuildSettingRow,
  TimedRoleAssignment,
  TimedRoleRow,
} from "../types";
import type { Env } from "../env";
import { buildBlocklistConfig, normalizeEmoji } from "../blocklist";
import { removeGuildMemberRole } from "../discord";

class ModerationStoreInputError extends Error {}

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
    `);

    this.sql.exec(
      "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)",
      "bot_user_id",
      env.BOT_USER_ID
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/config") {
      try {
        return Response.json(this.readConfig());
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/guild-emoji") {
      try {
        const body = parseGuildEmojiMutation(await request.json());
        return Response.json(this.applyGuildEmojiMutation(body));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/timed-role") {
      try {
        const body = parseTimedRoleUpsert(await request.json());
        await this.upsertTimedRole(body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/timed-role/remove") {
      try {
        const body = parseTimedRoleRemoval(await request.json());
        await this.deleteTimedRole(body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/timed-roles") {
      try {
        return Response.json(this.listTimedRolesByGuild(parseGuildId(url)));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/app-config") {
      try {
        const body = parseAppConfigMutation(await request.json());
        return Response.json(this.upsertAppConfig(body));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const expiredRows = this.readTimedRoleSelections(
      "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE expires_at_ms <= ? ORDER BY expires_at_ms ASC",
      Date.now()
    );

    for (const row of expiredRows) {
      try {
        await removeGuildMemberRole(
          row.guildId,
          row.userId,
          row.roleId,
          this.env.DISCORD_BOT_TOKEN
        );
        this.sql.exec(
          "DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?",
          row.guildId,
          row.userId,
          row.roleId
        );
      } catch (error) {
        console.error("Failed to remove expired timed role", error);
      }
    }

    await this.scheduleNextTimedRoleAlarm();
  }

  private readTimedRoleSelections(query: string, ...params: unknown[]): TimedRoleAssignment[] {
    const rows: TimedRoleRow[] = [...this.sql.exec(query, ...params)].map(
      mapTimedRoleRow
    );
    return rows.map(mapTimedRoleAssignment);
  }

  private readConfig(): BlocklistConfig {
    const guildRows: GuildSettingRow[] = [
      ...this.sql.exec("SELECT guild_id, moderation_enabled FROM guild_settings"),
    ].map((row) => ({
      guild_id: row.guild_id as string,
      moderation_enabled: row.moderation_enabled as number,
    }));
    const guildEmojiRows: GuildBlockedEmojiRow[] = [
      ...this.sql.exec(
        "SELECT guild_id, normalized_emoji FROM guild_blocked_emojis"
      ),
    ].map((row) => ({
      guild_id: row.guild_id as string,
      normalized_emoji: row.normalized_emoji as string,
    }));
    const appConfigRows: AppConfigRow[] = [
      ...this.sql.exec("SELECT key, value FROM app_config"),
    ].map((row) => ({
      key: row.key as string,
      value: row.value as string,
    }));

    return buildBlocklistConfig(guildRows, guildEmojiRows, appConfigRows);
  }

  private upsertAppConfig(body: {
    key: string;
    value: string;
  }): { ok: true } {
    this.sql.exec(
      "INSERT INTO app_config(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      body.key,
      body.value
    );

    return { ok: true };
  }

  private applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove"; }): BlocklistConfig {
    if (body.action === "add") {
      this.sql.exec(
        "INSERT OR IGNORE INTO guild_settings(guild_id, moderation_enabled) VALUES(?, ?)",
        body.guildId,
        1
      );
      this.sql.exec(
        "INSERT OR IGNORE INTO guild_blocked_emojis(guild_id, normalized_emoji) VALUES(?, ?)",
        body.guildId,
        body.emoji
      );
    } else {
      this.sql.exec(
        "DELETE FROM guild_blocked_emojis WHERE guild_id = ? AND normalized_emoji = ?",
        body.guildId,
        body.emoji
      );
    }

    return this.readConfig();
  }

  private async upsertTimedRole(body: TimedRoleAssignment): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      "INSERT INTO timed_roles(guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET duration_input = excluded.duration_input, expires_at_ms = excluded.expires_at_ms, updated_at_ms = excluded.updated_at_ms",
      body.guildId,
      body.userId,
      body.roleId,
      body.durationInput,
      body.expiresAtMs,
      now,
      now
    );
    await this.scheduleNextTimedRoleAlarm();
  }

  private async deleteTimedRole(body: {
    guildId: string;
    userId: string;
    roleId: string;
  }): Promise<void> {
    this.sql.exec(
      "DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?",
      body.guildId,
      body.userId,
      body.roleId
    );
    await this.scheduleNextTimedRoleAlarm();
  }

  private listTimedRolesByGuild(guildId: string): TimedRoleAssignment[] {
    return this.readTimedRoleSelections(
      "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC",
      guildId
    );
  }

  private async scheduleNextTimedRoleAlarm(): Promise<void> {
    const nextRow = [
      ...this.sql.exec(
        "SELECT expires_at_ms FROM timed_roles ORDER BY expires_at_ms ASC LIMIT 1"
      ),
    ][0];

    if (!nextRow) {
      await this.clearTimedRoleAlarm();
      return;
    }

    await this.ctx.storage.setAlarm(nextRow.expires_at_ms as number);
  }

  private async clearTimedRoleAlarm(): Promise<void> {
    const storageWithDeleteAlarm = this.ctx.storage as DurableObjectStorage & {
      deleteAlarm?: () => Promise<void>;
    };

    if (typeof storageWithDeleteAlarm.deleteAlarm === "function") {
      await storageWithDeleteAlarm.deleteAlarm();
    }
  }

  private errorResponse(error: unknown): Response {
    if (error instanceof SyntaxError || error instanceof ModerationStoreInputError) {
      return Response.json(
        { error: error.message || "Invalid JSON body" },
        { status: 400 }
      );
    }

    console.error("Moderation store request failed", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

function parseGuildEmojiMutation(body: unknown): { guildId: string; emoji: string; action: "add" | "remove" } {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  const guildId = body.guildId;
  const normalizedEmoji = normalizeEmoji(asOptionalString(body.emoji));
  const action = body.action;

  if (typeof guildId !== "string" || guildId.length === 0 || !normalizedEmoji || typeof action !== "string") {
    throw new ModerationStoreInputError("Missing guildId, emoji or action");
  }

  if (action !== "add" && action !== "remove") {
    throw new ModerationStoreInputError("Invalid action. Use 'add' or 'remove'");
  }

  return {
    guildId,
    emoji: normalizedEmoji,
    action,
  };
}

function parseAppConfigMutation(body: unknown): { key: string; value: string } {
  if (
    !isRecord(body) ||
    typeof body.key !== "string" ||
    body.key.length === 0 ||
    typeof body.value !== "string"
  ) {
    throw new ModerationStoreInputError("Missing app config key or value");
  }

  return {
    key: body.key,
    value: body.value,
  };
}

function parseTimedRoleUpsert(body: unknown): TimedRoleAssignment {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  const guildId = asRequiredString(body.guildId, "guildId");
  const userId = asRequiredString(body.userId, "userId");
  const roleId = asRequiredString(body.roleId, "roleId");
  const durationInput = asRequiredString(body.durationInput, "durationInput");
  const expiresAtMs = body.expiresAtMs;

  if (typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) {
    throw new ModerationStoreInputError("Missing expiresAtMs");
  }

  return {
    guildId,
    userId,
    roleId,
    durationInput,
    expiresAtMs,
  };
}

function parseTimedRoleRemoval(body: unknown): {
  guildId: string;
  userId: string;
  roleId: string;
} {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    userId: asRequiredString(body.userId, "userId"),
    roleId: asRequiredString(body.roleId, "roleId"),
  };
}

function parseGuildId(url: URL): string {
  return asRequiredString(url.searchParams.get("guildId"), "guildId");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function mapTimedRoleRow(row: Record<string, unknown>): TimedRoleRow {
  return {
    guild_id: row.guild_id as string,
    user_id: row.user_id as string,
    role_id: row.role_id as string,
    duration_input: row.duration_input as string,
    expires_at_ms: row.expires_at_ms as number,
    created_at_ms: row.created_at_ms as number,
    updated_at_ms: row.updated_at_ms as number,
  };
}

function mapTimedRoleAssignment(row: TimedRoleRow): TimedRoleAssignment {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    roleId: row.role_id,
    durationInput: row.duration_input,
    expiresAtMs: row.expires_at_ms,
  };
}
