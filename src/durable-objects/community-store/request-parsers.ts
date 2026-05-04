import type {
  NewMemberTimedRoleConfig,
  MarketplaceBusinessLog,
  MarketplaceConfig,
  MarketplacePost,
  TicketInstance,
  TicketPanelConfig,
  TimedRoleAssignment,
  LfgConfig,
  LfgPost,
} from "../../types";
import { normalizeEmoji } from "../../blocklist";

export class CommunityStoreInputError extends Error {}

export function parseGuildEmojiMutation(body: unknown): {
  guildId: string;
  emoji: string;
  action: "add" | "remove";
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  const guildId = body.guildId;
  const normalizedEmoji = normalizeEmoji(asOptionalString(body.emoji));
  const action = body.action;

  if (
    typeof guildId !== "string" ||
    guildId.length === 0 ||
    !normalizedEmoji ||
    typeof action !== "string"
  ) {
    throw new CommunityStoreInputError("Missing guildId, emoji or action");
  }

  if (action !== "add" && action !== "remove") {
    throw new CommunityStoreInputError("Invalid action. Use 'add' or 'remove'");
  }

  return {
    guildId,
    emoji: normalizedEmoji,
    action,
  };
}

export function parseAppConfigMutation(body: unknown): { key: string; value: string } {
  if (
    !isRecord(body) ||
    typeof body.key !== "string" ||
    body.key.length === 0 ||
    typeof body.value !== "string"
  ) {
    throw new CommunityStoreInputError("Missing app config key or value");
  }

  return {
    key: body.key,
    value: body.value,
  };
}

export function parseTimedRoleUpsert(body: unknown): TimedRoleAssignment {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  const guildId = asRequiredString(body.guildId, "guildId");
  const userId = asRequiredString(body.userId, "userId");
  const roleId = asRequiredString(body.roleId, "roleId");
  const durationInput = asRequiredString(body.durationInput, "durationInput");
  const expiresAtMs = body.expiresAtMs;

  if (typeof expiresAtMs !== "number" || !Number.isFinite(expiresAtMs)) {
    throw new CommunityStoreInputError("Missing expiresAtMs");
  }

  return {
    guildId,
    userId,
    roleId,
    durationInput,
    expiresAtMs,
  };
}

export function parseTimedRoleRemoval(body: unknown): {
  guildId: string;
  userId: string;
  roleId: string;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    userId: asRequiredString(body.userId, "userId"),
    roleId: asRequiredString(body.roleId, "roleId"),
  };
}

export function parseNewMemberTimedRoleConfig(body: unknown): NewMemberTimedRoleConfig {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  const roleId = asOptionalNullableString(body.roleId, "roleId");
  const durationInput = asOptionalNullableString(body.durationInput, "durationInput");

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    roleId,
    durationInput: roleId && durationInput ? durationInput : null,
  };
}

export function parseGuildNotificationChannelMutation(body: unknown): {
  guildId: string;
  notificationChannelId: string | null;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    notificationChannelId: asOptionalNullableString(
      body.notificationChannelId,
      "notificationChannelId",
    ),
  };
}

export function parseTicketPanelConfig(body: unknown): TicketPanelConfig {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    panelChannelId: asRequiredString(body.panelChannelId, "panelChannelId"),
    categoryChannelId: asRequiredString(body.categoryChannelId, "categoryChannelId"),
    transcriptChannelId: asRequiredString(body.transcriptChannelId, "transcriptChannelId"),
    panelEmoji: asOptionalNullableString(body.panelEmoji, "panelEmoji"),
    panelTitle: asOptionalNullableString(body.panelTitle, "panelTitle"),
    panelDescription: asOptionalNullableString(body.panelDescription, "panelDescription"),
    panelFooter: asOptionalNullableString(body.panelFooter, "panelFooter"),
    panelMessageId: asNullableString(body.panelMessageId, "panelMessageId"),
    ticketTypes: parseTicketTypes(body.ticketTypes),
  };
}

export function parseTicketInstance(body: unknown): TicketInstance {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
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

export function parseTicketCloseRequest(body: unknown): {
  guildId: string;
  channelId: string;
  closedByUserId: string;
  closedAtMs: number;
  transcriptMessageId: string | null;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
    closedAtMs: asRequiredFiniteNumber(body.closedAtMs, "closedAtMs"),
    transcriptMessageId: asNullableString(body.transcriptMessageId, "transcriptMessageId"),
  };
}

export function parseTicketDeleteRequest(body: unknown): { guildId: string; channelId: string } {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
  };
}

export function parseGuildIdRequest(body: unknown): { guildId: string } {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
  };
}

export function parseMarketplaceConfig(body: unknown): MarketplaceConfig {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    noticeChannelId: asNullableString(body.noticeChannelId, "noticeChannelId"),
    noticeMessageId: asNullableString(body.noticeMessageId, "noticeMessageId"),
    logChannelId: asNullableString(body.logChannelId, "logChannelId"),
    serverOptions: parseMarketplaceServerOptions(body.serverOptions),
    updatedAtMs: asRequiredFiniteNumber(body.updatedAtMs, "updatedAtMs"),
  };
}

export function parseMarketplacePost(body: unknown): MarketplacePost {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    id: asRequiredString(body.id, "id"),
    ownerId: asRequiredString(body.ownerId, "ownerId"),
    ownerDisplayName: asRequiredString(body.ownerDisplayName, "ownerDisplayName"),
    tradeType: asMarketplaceTradeType(body.tradeType),
    serverId: asRequiredString(body.serverId, "serverId"),
    serverLabel: asRequiredString(body.serverLabel, "serverLabel"),
    have: asRequiredString(body.have, "have"),
    want: asRequiredString(body.want, "want"),
    extra: asRequiredString(body.extra, "extra"),
    channelId: asRequiredString(body.channelId, "channelId"),
    messageId: asNullableString(body.messageId, "messageId"),
    active: asBoolean(body.active, "active"),
    createdAtMs: asRequiredFiniteNumber(body.createdAtMs, "createdAtMs"),
    closedAtMs: asNullableFiniteNumber(body.closedAtMs, "closedAtMs"),
    closedByUserId: asNullableString(body.closedByUserId, "closedByUserId"),
  };
}

export function parseMarketplacePostMessage(body: unknown): {
  guildId: string;
  postId: string;
  messageId: string;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    messageId: asRequiredString(body.messageId, "messageId"),
  };
}

export function parseMarketplacePostClose(body: unknown): {
  guildId: string;
  postId: string;
  closedByUserId: string;
  closedAtMs: number;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
    closedAtMs: asRequiredFiniteNumber(body.closedAtMs, "closedAtMs"),
  };
}

export function parseMarketplaceLog(body: unknown): MarketplaceBusinessLog {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    id: asRequiredString(body.id, "id"),
    timestampMs: asRequiredFiniteNumber(body.timestampMs, "timestampMs"),
    buyerId: asRequiredString(body.buyerId, "buyerId"),
    buyerDisplayName: asRequiredString(body.buyerDisplayName, "buyerDisplayName"),
    sellerId: asRequiredString(body.sellerId, "sellerId"),
    postId: asRequiredString(body.postId, "postId"),
    channelId: asRequiredString(body.channelId, "channelId"),
    messageId: asNullableString(body.messageId, "messageId"),
    tradeType: asMarketplaceTradeType(body.tradeType),
    serverLabel: asRequiredString(body.serverLabel, "serverLabel"),
    dmSent: asBoolean(body.dmSent, "dmSent"),
    dmError: asNullableString(body.dmError, "dmError"),
    have: asRequiredString(body.have, "have"),
    want: asRequiredString(body.want, "want"),
  };
}

export function parseLfgConfig(body: unknown): LfgConfig {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    noticeChannelId: asNullableString(body.noticeChannelId, "noticeChannelId"),
    noticeMessageId: asNullableString(body.noticeMessageId, "noticeMessageId"),
    serverOptions: parseLfgServerOptions(body.serverOptions),
    updatedAtMs: asRequiredFiniteNumber(body.updatedAtMs, "updatedAtMs"),
  };
}

export function parseLfgPost(body: unknown): LfgPost {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    id: asRequiredString(body.id, "id"),
    ownerId: asRequiredString(body.ownerId, "ownerId"),
    ownerDisplayName: asRequiredString(body.ownerDisplayName, "ownerDisplayName"),
    serverId: asRequiredString(body.serverId, "serverId"),
    serverLabel: asRequiredString(body.serverLabel, "serverLabel"),
    whenPlay: asRequiredString(body.whenPlay, "whenPlay"),
    lookingFor: asRequiredString(body.lookingFor, "lookingFor"),
    extraInfo: asString(body.extraInfo, "extraInfo"),
    channelId: asRequiredString(body.channelId, "channelId"),
    messageId: asNullableString(body.messageId, "messageId"),
    active: asBoolean(body.active, "active"),
    createdAtMs: asRequiredFiniteNumber(body.createdAtMs, "createdAtMs"),
    closedAtMs: asNullableFiniteNumber(body.closedAtMs, "closedAtMs"),
    closedByUserId: asNullableString(body.closedByUserId, "closedByUserId"),
  };
}

export function parseLfgPostMessage(body: unknown): {
  guildId: string;
  postId: string;
  messageId: string;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    messageId: asRequiredString(body.messageId, "messageId"),
  };
}

export function parseLfgPostClose(body: unknown): {
  guildId: string;
  postId: string;
  closedByUserId: string;
  closedAtMs: number;
} {
  if (!isRecord(body)) {
    throw new CommunityStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
    closedAtMs: asRequiredFiniteNumber(body.closedAtMs, "closedAtMs"),
  };
}

export function asRequiredSearchParam(searchParams: URLSearchParams, fieldName: string): string {
  const value = searchParams.get(fieldName);

  if (typeof value !== "string" || value.length === 0) {
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function parseTicketTypes(value: unknown): TicketPanelConfig["ticketTypes"] {
  if (!Array.isArray(value)) {
    throw new CommunityStoreInputError("Missing ticketTypes");
  }

  const seenIds = new Set<string>();
  return value.map((ticketType, index) => {
    if (!isRecord(ticketType)) {
      throw new CommunityStoreInputError(`Invalid ticketTypes[${index}]`);
    }

    const id = asRequiredString(ticketType.id, `ticketTypes[${index}].id`);
    if (seenIds.has(id)) {
      throw new CommunityStoreInputError(`Duplicate ticketTypes[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(ticketType.label, `ticketTypes[${index}].label`),
      emoji: asNullableString(ticketType.emoji, `ticketTypes[${index}].emoji`),
      buttonStyle: asTicketButtonStyle(ticketType.buttonStyle),
      supportRoleId: asRequiredString(
        ticketType.supportRoleId,
        `ticketTypes[${index}].supportRoleId`,
      ),
      channelNamePrefix: asRequiredString(
        ticketType.channelNamePrefix,
        `ticketTypes[${index}].channelNamePrefix`,
      ),
      questions: parseTicketQuestions(ticketType.questions, index),
    };
  });
}

function parseTicketQuestions(
  value: unknown,
  ticketTypeIndex: number,
): TicketPanelConfig["ticketTypes"][number]["questions"] {
  if (!Array.isArray(value)) {
    throw new CommunityStoreInputError(`Missing ticketTypes[${ticketTypeIndex}].questions`);
  }
  if (value.length > 5) {
    throw new CommunityStoreInputError(
      `ticketTypes[${ticketTypeIndex}].questions cannot exceed 5 entries`,
    );
  }

  return value.map((question, questionIndex) => {
    if (!isRecord(question)) {
      throw new CommunityStoreInputError(
        `Invalid ticketTypes[${ticketTypeIndex}].questions[${questionIndex}]`,
      );
    }

    return {
      id: asRequiredString(
        question.id,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].id`,
      ),
      label: asRequiredString(
        question.label,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].label`,
      ),
      style: asTicketQuestionStyle(question.style),
      placeholder: asNullableString(
        question.placeholder,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].placeholder`,
      ),
      required: asBoolean(
        question.required,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].required`,
      ),
    };
  });
}

function parseTicketAnswers(value: unknown): TicketInstance["answers"] {
  if (!Array.isArray(value)) {
    throw new CommunityStoreInputError("Missing answers");
  }

  return value.map((answer, index) => {
    if (!isRecord(answer)) {
      throw new CommunityStoreInputError(`Invalid answers[${index}]`);
    }

    return {
      questionId: asRequiredString(answer.questionId, `answers[${index}].questionId`),
      label: asRequiredString(answer.label, `answers[${index}].label`),
      value: asRequiredString(answer.value, `answers[${index}].value`),
    };
  });
}

function parseMarketplaceServerOptions(value: unknown): MarketplaceConfig["serverOptions"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25) {
    throw new CommunityStoreInputError("serverOptions must contain 1-25 entries");
  }

  const seenIds = new Set<string>();
  return value.map((option, index) => {
    if (!isRecord(option)) {
      throw new CommunityStoreInputError(`Invalid serverOptions[${index}]`);
    }

    const id = asRequiredString(option.id, `serverOptions[${index}].id`);
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
      throw new CommunityStoreInputError(`Invalid serverOptions[${index}].id`);
    }
    if (seenIds.has(id)) {
      throw new CommunityStoreInputError(`Duplicate serverOptions[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(option.label, `serverOptions[${index}].label`),
      emoji: asNullableString(option.emoji, `serverOptions[${index}].emoji`),
    };
  });
}

function parseLfgServerOptions(value: unknown): LfgConfig["serverOptions"] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25) {
    throw new CommunityStoreInputError("serverOptions must contain 1-25 entries");
  }

  const seenIds = new Set<string>();
  return value.map((option, index) => {
    if (!isRecord(option)) {
      throw new CommunityStoreInputError(`Invalid serverOptions[${index}]`);
    }

    const id = asRequiredString(option.id, `serverOptions[${index}].id`);
    if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
      throw new CommunityStoreInputError(`Invalid serverOptions[${index}].id`);
    }
    if (seenIds.has(id)) {
      throw new CommunityStoreInputError(`Duplicate serverOptions[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(option.label, `serverOptions[${index}].label`),
      emoji: asNullableString(option.emoji, `serverOptions[${index}].emoji`),
    };
  });
}

function asMarketplaceTradeType(value: unknown): MarketplacePost["tradeType"] {
  if (value !== "have" && value !== "want") {
    throw new CommunityStoreInputError("Missing tradeType");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRequiredFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asNullableFiniteNumber(value: unknown, fieldName: string): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
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
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
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
    throw new CommunityStoreInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asTicketStatus(value: unknown): TicketInstance["status"] {
  if (value !== "open" && value !== "closed") {
    throw new CommunityStoreInputError("Missing status");
  }

  return value;
}

function asTicketButtonStyle(
  value: unknown,
): TicketPanelConfig["ticketTypes"][number]["buttonStyle"] {
  if (value !== "primary" && value !== "secondary" && value !== "success" && value !== "danger") {
    throw new CommunityStoreInputError("Missing buttonStyle");
  }

  return value;
}

function asTicketQuestionStyle(
  value: unknown,
): TicketPanelConfig["ticketTypes"][number]["questions"][number]["style"] {
  if (value !== "short" && value !== "paragraph") {
    throw new CommunityStoreInputError("Missing style");
  }

  return value;
}
