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

export interface NewMemberTimedRoleConfig {
  guildId: string;
  roleId: string | null;
  durationInput: string | null;
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
  panelEmoji: string | null;
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

export type MarketplaceTradeType = "have" | "want";

export interface MarketplaceServerOption {
  id: string;
  label: string;
  emoji: string | null;
}

export interface MarketplaceConfig {
  guildId: string;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
  logChannelId: string | null;
  serverOptions: MarketplaceServerOption[];
  updatedAtMs: number;
}

export interface MarketplacePost {
  guildId: string;
  id: string;
  ownerId: string;
  ownerDisplayName: string;
  tradeType: MarketplaceTradeType;
  serverId: string;
  serverLabel: string;
  have: string;
  want: string;
  extra: string;
  channelId: string;
  messageId: string | null;
  active: boolean;
  createdAtMs: number;
  closedAtMs: number | null;
  closedByUserId: string | null;
}

export interface MarketplaceBusinessLog {
  guildId: string;
  id: string;
  timestampMs: number;
  buyerId: string;
  buyerDisplayName: string;
  sellerId: string;
  postId: string;
  channelId: string;
  messageId: string | null;
  tradeType: MarketplaceTradeType;
  serverLabel: string;
  dmSent: boolean;
  dmError: string | null;
  have: string;
  want: string;
}
