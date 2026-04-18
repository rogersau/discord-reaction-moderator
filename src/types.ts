// Discord webhook event types

export interface DiscordEmoji {
  id: string | null;
  name: string | null;
  animated: boolean;
}

export interface DiscordReaction {
  channel_id: string;
  message_id: string;
  guild_id: string | undefined;
  emoji: DiscordEmoji;
  user_id: string;
}

export interface GuildSettingRow {
  guild_id: string;
  moderation_enabled: number;
}

export interface GuildBlockedEmojiRow {
  guild_id: string;
  normalized_emoji: string;
}

export interface AppConfigRow {
  key: string;
  value: string;
}

export interface TimedRoleRow {
  guild_id: string;
  user_id: string;
  role_id: string;
  duration_input: string;
  expires_at_ms: number;
  created_at_ms: number;
  updated_at_ms: number;
}

export interface TimedRoleAssignment {
  guildId: string;
  userId: string;
  roleId: string;
  durationInput: string;
  expiresAtMs: number;
}

// Effective blocklist config materialized from the moderation store.
export interface BlocklistConfig {
  guilds: {
    [guildId: string]: {
      enabled: boolean;
      emojis: string[];
    };
  };
  botUserId: string;
}

export type TicketQuestionStyle = "short" | "paragraph";

export type TicketButtonStyle = "primary" | "secondary" | "success" | "danger";

export interface TicketQuestion {
  id: string;
  label: string;
  style: TicketQuestionStyle;
  placeholder: string | null;
  required: boolean;
}

export interface TicketTypeConfig {
  id: string;
  label: string;
  emoji: string | null;
  buttonStyle: TicketButtonStyle;
  supportRoleId: string;
  channelNamePrefix: string;
  questions: TicketQuestion[];
}

export interface TicketPanelConfig {
  guildId: string;
  panelChannelId: string;
  categoryChannelId: string;
  transcriptChannelId: string;
  panelTitle: string | null;
  panelDescription: string | null;
  panelFooter: string | null;
  panelMessageId: string | null;
  ticketTypes: TicketTypeConfig[];
}

export interface TicketAnswer {
  questionId: string;
  label: string;
  value: string;
}

export interface TicketInstance {
  guildId: string;
  channelId: string;
  ticketTypeId: string;
  ticketTypeLabel: string;
  openerUserId: string;
  supportRoleId: string | null;
  status: "open" | "closed";
  answers: TicketAnswer[];
  openedAtMs: number;
  closedAtMs: number | null;
  closedByUserId: string | null;
  transcriptMessageId: string | null;
}
