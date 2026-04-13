import type {
  AppConfigRow,
  BlocklistConfig,
  GlobalBlockedEmojiRow,
  GuildBlockedEmojiRow,
  GuildSettingRow,
} from "../types";
import type { Env } from "../env";
import { buildBlocklistConfig, normalizeEmoji } from "../blocklist";
import { DEFAULT_BLOCKLIST } from "../types";

const DEFAULT_SEED_KEY = "default_blocklist_seeded";

class ModerationStoreInputError extends Error {}

export class ModerationStoreDO implements DurableObject {
  private readonly sql: DurableObjectStorage["sql"];

  constructor(ctx: DurableObjectState, _env: Env) {
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS global_blocked_emojis (
        normalized_emoji TEXT PRIMARY KEY
      );
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
    `);

    this.seedDefaultsOnce();

    this.sql.exec(
      "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)",
      "bot_user_id",
      _env.BOT_USER_ID
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

    if (
      (request.method === "POST" || request.method === "PUT") &&
      url.pathname === "/emoji"
    ) {
      try {
        const body = parseGlobalEmojiMutation(await request.json());
        return Response.json(this.applyGlobalEmojiMutation(body));
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

  private readConfig(): BlocklistConfig {
    const globalRows: GlobalBlockedEmojiRow[] = [
      ...this.sql.exec("SELECT normalized_emoji FROM global_blocked_emojis"),
    ].map((row) => ({
      normalized_emoji: row.normalized_emoji as string,
    }));
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

    return buildBlocklistConfig(globalRows, guildRows, guildEmojiRows, appConfigRows);
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

  private applyGlobalEmojiMutation(body: {
    emoji: string;
    action: "add" | "remove";
  }): BlocklistConfig {
    if (body.action === "add") {
      this.sql.exec(
        "INSERT OR IGNORE INTO global_blocked_emojis(normalized_emoji) VALUES(?)",
        body.emoji
      );
    } else {
      this.sql.exec(
        "DELETE FROM global_blocked_emojis WHERE normalized_emoji = ?",
        body.emoji
      );
    }

    return this.readConfig();
  }

  private seedDefaultsOnce(): void {
    const isSeeded =
      [...this.sql.exec("SELECT key FROM app_config WHERE key = ?", DEFAULT_SEED_KEY)]
        .length > 0;

    if (isSeeded) {
      return;
    }

    if (!this.hasExistingState()) {
      for (const emoji of DEFAULT_BLOCKLIST.emojis) {
        this.sql.exec(
          "INSERT OR IGNORE INTO global_blocked_emojis(normalized_emoji) VALUES(?)",
          emoji
        );
      }
    }

    this.sql.exec(
      "INSERT OR IGNORE INTO app_config(key, value) VALUES(?, ?)",
      DEFAULT_SEED_KEY,
      "1"
    );
  }

  private hasExistingState(): boolean {
    return (
      [...this.sql.exec("SELECT 1 FROM global_blocked_emojis LIMIT 1")].length > 0 ||
      [...this.sql.exec("SELECT 1 FROM guild_settings LIMIT 1")].length > 0 ||
      [...this.sql.exec("SELECT 1 FROM guild_blocked_emojis LIMIT 1")].length > 0 ||
      [...this.sql.exec("SELECT 1 FROM app_config LIMIT 1")].length > 0
    );
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

function parseGlobalEmojiMutation(body: unknown): {
  emoji: string;
  action: "add" | "remove";
} {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  const normalizedEmoji = normalizeEmoji(asOptionalString(body.emoji));
  const action = body.action;

  if (!normalizedEmoji || typeof action !== "string") {
    throw new ModerationStoreInputError("Missing emoji or action");
  }

  if (action !== "add" && action !== "remove") {
    throw new ModerationStoreInputError("Invalid action. Use 'add' or 'remove'");
  }

  return {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
