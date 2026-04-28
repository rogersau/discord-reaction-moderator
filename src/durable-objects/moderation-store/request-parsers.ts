import type { TicketInstance, TicketPanelConfig, TimedRoleAssignment } from "../../types";
import { normalizeEmoji } from "../../blocklist";

export class ModerationStoreInputError extends Error {}

export function parseGuildEmojiMutation(body: unknown): { guildId: string; emoji: string; action: "add" | "remove" } {
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

export function parseAppConfigMutation(body: unknown): { key: string; value: string } {
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

export function parseTimedRoleUpsert(body: unknown): TimedRoleAssignment {
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

export function parseTimedRoleRemoval(body: unknown): {
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

export function parseTicketPanelConfig(body: unknown): TicketPanelConfig {
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

export function parseTicketInstance(body: unknown): TicketInstance {
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

export function parseTicketCloseRequest(body: unknown): {
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

export function parseTicketDeleteRequest(body: unknown): { guildId: string; channelId: string } {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    channelId: asRequiredString(body.channelId, "channelId"),
  };
}

export function parseGuildIdRequest(body: unknown): { guildId: string } {
  if (!isRecord(body)) {
    throw new ModerationStoreInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
  };
}

export function asRequiredSearchParam(searchParams: URLSearchParams, fieldName: string): string {
  const value = searchParams.get(fieldName);

  if (typeof value !== "string" || value.length === 0) {
    throw new ModerationStoreInputError(`Missing ${fieldName}`);
  }

  return value;
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
