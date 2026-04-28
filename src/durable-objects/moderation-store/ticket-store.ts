import type { TicketInstance, TicketPanelConfig } from "../../types";
import { parseTicketPanelStorage, serializeTicketPanelStorage } from "../../tickets";

export function reserveNextTicketNumber(
  sql: DurableObjectStorage["sql"],
  guildId: string
): number {
  const row = [
    ...sql.exec(
      "SELECT next_ticket_number FROM ticket_counters WHERE guild_id = ?",
      guildId
    ),
  ][0] as Record<string, unknown> | undefined;

  if (!row) {
    sql.exec(
      "INSERT INTO ticket_counters(guild_id, next_ticket_number) VALUES(?, ?)",
      guildId,
      2
    );
    return 1;
  }

  const ticketNumber = row.next_ticket_number as number;
  sql.exec(
    "UPDATE ticket_counters SET next_ticket_number = ? WHERE guild_id = ?",
    ticketNumber + 1,
    guildId
  );
  return ticketNumber;
}

export function readTicketPanelConfig(
  sql: DurableObjectStorage["sql"],
  guildId: string
): TicketPanelConfig | null {
  const row = [
    ...sql.exec(
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

export function upsertTicketPanelConfig(
  sql: DurableObjectStorage["sql"],
  panel: TicketPanelConfig
): void {
  sql.exec(
    "INSERT INTO ticket_panels(guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json) VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET panel_channel_id = excluded.panel_channel_id, category_channel_id = excluded.category_channel_id, transcript_channel_id = excluded.transcript_channel_id, panel_message_id = excluded.panel_message_id, ticket_types_json = excluded.ticket_types_json",
    panel.guildId,
    panel.panelChannelId,
    panel.categoryChannelId,
    panel.transcriptChannelId,
    panel.panelMessageId,
    serializeTicketPanelStorage(panel)
  );
}

export function createTicketInstance(
  sql: DurableObjectStorage["sql"],
  instance: TicketInstance
): void {
  sql.exec(
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

export function deleteTicketInstance(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  channelId: string
): void {
  sql.exec("DELETE FROM ticket_instances WHERE guild_id = ? AND channel_id = ?", guildId, channelId);
}

export function readOpenTicketByChannel(
  sql: DurableObjectStorage["sql"],
  guildId: string,
  channelId: string
): TicketInstance | null {
  const row = [
    ...sql.exec(
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

export function closeTicketInstance(
  sql: DurableObjectStorage["sql"],
  body: {
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }
): void {
  const result = sql.exec(
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
