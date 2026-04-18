import type { TicketPanelConfig } from "../types";

export interface AppConfigMutation {
  key: string;
  value: string;
}

export interface AdminSessionPayload {
  exp: number;
}

export type TicketPanelConfigPayload = TicketPanelConfig;

export type TicketPanelConfigResource = TicketPanelConfig;

export interface GuildTicketResourceSummary {
  guildId: string;
  ticketPanelConfig: TicketPanelConfigResource | null;
  openTicketCount: number;
}
