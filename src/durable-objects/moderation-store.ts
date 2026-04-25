import type {
  AppConfigRow,
  BlocklistConfig,
  GuildBlockedEmojiRow,
  GuildSettingRow,
  TicketInstance,
  TicketPanelConfig,
  TimedRoleAssignment,
  TimedRoleRow,
} from "../types";
import type { Env } from "../env";
import { buildBlocklistConfig, normalizeEmoji } from "../blocklist";
import { removeGuildMemberRole } from "../discord";
import { parseTicketPanelStorage, serializeTicketPanelStorage } from "../tickets";

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
        const guildId = url.searchParams.get("guildId");
        return Response.json(
          guildId ? this.listTimedRolesByGuild(guildId) : this.listTimedRoles()
        );
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

    if (request.method === "POST" && url.pathname === "/ticket-number/next") {
      try {
        const body = parseGuildIdRequest(await request.json());
        return Response.json({ ticketNumber: this.reserveNextTicketNumber(body.guildId) });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/ticket-panel") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        return Response.json(this.readTicketPanelConfig(guildId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-panel") {
      try {
        const body = parseTicketPanelConfig(await request.json());
        await this.upsertTicketPanelConfig(body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance") {
      try {
        const body = parseTicketInstance(await request.json());
        await this.createTicketInstance(body);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "GET" && url.pathname === "/ticket-instance/open") {
      try {
        const guildId = asRequiredSearchParam(url.searchParams, "guildId");
        const channelId = asRequiredSearchParam(url.searchParams, "channelId");
        return Response.json(await this.readOpenTicketByChannel(guildId, channelId));
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance/delete") {
      try {
        const body = parseTicketDeleteRequest(await request.json());
        await this.deleteTicketInstance(body.guildId, body.channelId);
        return Response.json({ ok: true });
      } catch (error) {
        return this.errorResponse(error);
      }
    }

    if (request.method === "POST" && url.pathname === "/ticket-instance/close") {
      try {
        const body = parseTicketCloseRequest(await request.json());
        await this.closeTicketInstance(body);
        return Response.json({ ok: true });
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

  private reserveNextTicketNumber(guildId: string): number {
    const row = [
      ...this.sql.exec(
        "SELECT next_ticket_number FROM ticket_counters WHERE guild_id = ?",
        guildId
      ),
    ][0] as Record<string, unknown> | undefined;

    if (!row) {
      this.sql.exec(
        "INSERT INTO ticket_counters(guild_id, next_ticket_number) VALUES(?, ?)",
        guildId,
        2
      );
      return 1;
    }

    const ticketNumber = row.next_ticket_number as number;
    this.sql.exec(
      "UPDATE ticket_counters SET next_ticket_number = ? WHERE guild_id = ?",
      ticketNumber + 1,
      guildId
    );
    return ticketNumber;
  }

  private readTicketPanelConfig(guildId: string): TicketPanelConfig | null {
    const row = [
      ...this.sql.exec(
        "SELECT guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json FROM ticket_panels WHERE guild_id = ?",
        guildId
      ),
    ][0] as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const storedPanel = parseTicketPanelStorage(row.ticket_types_json as string);

    return {
      guildId: row.guild_id as string,
      panelChannelId: row.panel_channel_id as string,
      categoryChannelId: row.category_channel_id as string,
      transcriptChannelId: row.transcript_channel_id as string,
      panelTitle: storedPanel.panelTitle,
      panelDescription: storedPanel.panelDescription,
      panelFooter: storedPanel.panelFooter,
      panelMessageId: row.panel_message_id as string | null,
      ticketTypes: storedPanel.ticketTypes,
    };
  }

  private async upsertTicketPanelConfig(panel: TicketPanelConfig): Promise<void> {
    this.sql.exec(
      "INSERT INTO ticket_panels(guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET panel_channel_id = excluded.panel_channel_id, category_channel_id = excluded.category_channel_id, transcript_channel_id = excluded.transcript_channel_id, panel_message_id = excluded.panel_message_id, ticket_types_json = excluded.ticket_types_json",
      panel.guildId,
      panel.panelChannelId,
      panel.categoryChannelId,
      panel.transcriptChannelId,
      panel.panelMessageId,
      serializeTicketPanelStorage(panel)
    );
  }

  private async createTicketInstance(instance: TicketInstance): Promise<void> {
    this.sql.exec(
      "INSERT INTO ticket_instances(guild_id, channel_id, ticket_type_id, ticket_type_label, opener_user_id, support_role_id, status, answers_json, opened_at_ms, closed_at_ms, closed_by_user_id, transcript_message_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
  }

  private async deleteTicketInstance(guildId: string, channelId: string): Promise<void> {
    this.sql.exec("DELETE FROM ticket_instances WHERE guild_id = ? AND channel_id = ?", guildId, channelId);
  }

  private async readOpenTicketByChannel(guildId: string, channelId: string): Promise<TicketInstance | null> {
    const row = [
      ...this.sql.exec(
        "SELECT guild_id, channel_id, ticket_type_id, ticket_type_label, opener_user_id, support_role_id, status, answers_json, opened_at_ms, closed_at_ms, closed_by_user_id, transcript_message_id FROM ticket_instances WHERE guild_id = ? AND channel_id = ? AND status = 'open'",
        guildId,
        channelId
      ),
    ][0] as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    return {
      guildId: row.guild_id as string,
      channelId: row.channel_id as string,
      ticketTypeId: row.ticket_type_id as string,
      ticketTypeLabel: row.ticket_type_label as string,
      openerUserId: row.opener_user_id as string,
      supportRoleId: row.support_role_id as string | null,
      status: row.status as TicketInstance["status"],
      answers: JSON.parse(row.answers_json as string) as TicketInstance["answers"],
      openedAtMs: row.opened_at_ms as number,
      closedAtMs: row.closed_at_ms as number | null,
      closedByUserId: row.closed_by_user_id as string | null,
      transcriptMessageId: row.transcript_message_id as string | null,
    };
  }

  private async closeTicketInstance(body: {
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }): Promise<void> {
    const result = this.sql.exec(
      "UPDATE ticket_instances SET status = 'closed', closed_by_user_id = ?, closed_at_ms = ?, transcript_message_id = ? WHERE guild_id = ? AND channel_id = ? AND status = 'open'",
      body.closedByUserId,
      body.closedAtMs,
      body.transcriptMessageId,
      body.guildId,
      body.channelId
    );

    if (result.rowsWritten < 1) {
      throw new Error(`No open ticket found for guild ${body.guildId} channel ${body.channelId}`);
    }
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

  private listTimedRoles(): TimedRoleAssignment[] {
    return this.readTimedRoleSelections(
      "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles ORDER BY guild_id ASC, expires_at_ms ASC"
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

function parseTicketPanelConfig(body: unknown): TicketPanelConfig {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    panelChannelId: asRequiredString(body.panelChannelId, "panelChannelId"),
    categoryChannelId: asRequiredString(body.categoryChannelId, "categoryChannelId"),
    transcriptChannelId: asRequiredString(body.transcriptChannelId, "transcriptChannelId"),
    panelTitle: asOptionalNullableString(body.panelTitle, "panelTitle"),
    panelDescription: asOptionalNullableString(body.panelDescription, "panelDescription"),
    panelFooter: asOptionalNullableString(body.panelFooter, "panelFooter"),
    panelMessageId: asNullableString(body.panelMessageId, "panelMessageId"),
    ticketTypes: parseTicketTypes(body.ticketTypes),
  };
}

function parseTicketInstance(body: unknown): TicketInstance {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
    ticketTypeId: asRequiredString(body.ticketTypeId, "ticketTypeId"),
    ticketTypeLabel: asRequiredString(body.ticketTypeLabel, "ticketTypeLabel"),
    openerUserId: asRequiredString(body.openerUserId, "openerUserId"),
    supportRoleId: asNullableString(body.supportRoleId, "supportRoleId"),
    status: asTicketStatus(body.status),
    answers: parseTicketAnswers(body.answers),
    openedAtMs: asRequiredFiniteNumber(body.openedAtMs, "openedAtMs"),
    closedAtMs: asNullableFiniteNumber(body.closedAtMs, "closedAtMs"),
    closedByUserId: asNullableString(body.closedByUserId, "closedByUserId"),
    transcriptMessageId: asNullableString(body.transcriptMessageId, "transcriptMessageId"),
  };
}

function parseTicketCloseRequest(body: unknown): {
  guildId: string;
  channelId: string;
  closedByUserId: string;
  closedAtMs: number;
  transcriptMessageId: string | null;
} {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
    closedAtMs: asRequiredFiniteNumber(body.closedAtMs, "closedAtMs"),
    transcriptMessageId: asNullableString(body.transcriptMessageId, "transcriptMessageId"),
  };
}

function parseTicketDeleteRequest(body: unknown): { guildId: string; channelId: string } {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
  };
}

function parseGuildIdRequest(body: unknown): { guildId: string } {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
  };
}

function parseTicketTypes(value: unknown): TicketPanelConfig["ticketTypes"] {
  if (!Array.isArray(value)) {
    throw new ModerationStoreInputError("Missing ticketTypes");
  }

  const seenIds = new Set<string>();
  return value.map((ticketType, index) => {
    if (!isRecord(ticketType)) {
      throw new ModerationStoreInputError(`Invalid ticketTypes[${index}]`);
    }

    const id = asRequiredString(ticketType.id, `ticketTypes[${index}].id`);
    if (seenIds.has(id)) {
      throw new ModerationStoreInputError(`Duplicate ticketTypes[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(ticketType.label, `ticketTypes[${index}].label`),
      emoji: asNullableString(ticketType.emoji, `ticketTypes[${index}].emoji`),
      buttonStyle: asTicketButtonStyle(ticketType.buttonStyle),
      supportRoleId: asRequiredString(ticketType.supportRoleId, `ticketTypes[${index}].supportRoleId`),
      channelNamePrefix: asRequiredString(ticketType.channelNamePrefix, `ticketTypes[${index}].channelNamePrefix`),
      questions: parseTicketQuestions(ticketType.questions, index),
    };
  });
}

function parseTicketQuestions(value: unknown, ticketTypeIndex: number): TicketPanelConfig["ticketTypes"][number]["questions"] {
  if (!Array.isArray(value)) {
    throw new ModerationStoreInputError(`Missing ticketTypes[${ticketTypeIndex}].questions`);
  }
  if (value.length > 5) {
    throw new ModerationStoreInputError(`ticketTypes[${ticketTypeIndex}].questions cannot exceed 5 entries`);
  }

  return value.map((question, questionIndex) => {
    if (!isRecord(question)) {
      throw new ModerationStoreInputError(`Invalid ticketTypes[${ticketTypeIndex}].questions[${questionIndex}]`);
    }

    return {
      id: asRequiredString(question.id, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].id`),
      label: asRequiredString(question.label, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].label`),
      style: asTicketQuestionStyle(question.style),
      placeholder: asNullableString(question.placeholder, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].placeholder`),
      required: asBoolean(question.required, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].required`),
    };
  });
}

function parseTicketAnswers(value: unknown): TicketInstance["answers"] {
  if (!Array.isArray(value)) {
    throw new ModerationStoreInputError("Missing answers");
  }

  return value.map((answer, index) => {
    if (!isRecord(answer)) {
      throw new ModerationStoreInputError(`Invalid answers[${index}]`);
    }

    return {
      questionId: asRequiredString(answer.questionId, `answers[${index}].questionId`),
      label: asRequiredString(answer.label, `answers[${index}].label`),
      value: asRequiredString(answer.value, `answers[${index}].value`),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRequiredFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asNullableFiniteNumber(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
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

function asNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asOptionalNullableString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = asRequiredString(value, fieldName).trim();
  return normalized.length > 0 ? normalized : null;
}

function asBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asTicketStatus(value: unknown): TicketInstance["status"] {
  if (value !== "open" && value !== "closed") {
    throw new ModerationStoreInputError("Missing status");
  }

  return value;
}

function asTicketButtonStyle(value: unknown): TicketPanelConfig["ticketTypes"][number]["buttonStyle"] {
  if (value !== "primary" && value !== "secondary" && value !== "success" && value !== "danger") {
    throw new ModerationStoreInputError("Missing buttonStyle");
  }

  return value;
}

function asTicketQuestionStyle(value: unknown): TicketPanelConfig["ticketTypes"][number]["questions"][number]["style"] {
  if (value !== "short" && value !== "paragraph") {
    throw new ModerationStoreInputError("Missing style");
  }

  return value;
}

function asRequiredSearchParam(searchParams: URLSearchParams, fieldName: string): string {
  const value = searchParams.get(fieldName);

  if (typeof value !== "string" || value.length === 0) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
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
