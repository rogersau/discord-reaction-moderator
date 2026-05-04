import type { TicketPanelConfig } from "../types";

export interface AppConfigMutation {
  key: string;
  value: string;
}

export interface AdminSessionPayload {
  exp: number;
}

export interface AdminGuildDirectoryEntry {
  guildId: string;
  name: string;
  label: string;
}

export interface AdminGuildDirectoryResponse {
  guilds: AdminGuildDirectoryEntry[];
}

export type AdminPermissionFeature = "blocklist" | "timed-roles" | "tickets" | "marketplace" | "lfg";

export type AdminPermissionCheckStatus = "ok" | "warning" | "error";

export interface AdminPermissionCheck {
  label: string;
  status: AdminPermissionCheckStatus;
  detail: string;
}

export interface AdminPermissionCheckResponse {
  guildId: string;
  feature: AdminPermissionFeature;
  checks: AdminPermissionCheck[];
}

export type TicketPanelConfigPayload = TicketPanelConfig;

export type TicketPanelConfigResource = TicketPanelConfig;

export interface GuildTicketResourceSummary {
  guildId: string;
  ticketPanelConfig: TicketPanelConfigResource | null;
  openTicketCount: number;
}
