import type { TicketInstance, TicketQuestion, TicketTypeConfig } from "./types";

const TICKET_OPEN_CUSTOM_ID_PREFIX = "ticket:open:";
const TICKET_CLOSE_CUSTOM_ID_PREFIX = "ticket:close:";

export interface TicketModalResponse {
  type: 9;
  data: {
    custom_id: string;
    title: string;
    components: Array<{
      type: 1;
      components: Array<{
        type: 4;
        custom_id: string;
        label: string;
        style: 1 | 2;
        placeholder?: string;
        required?: boolean;
      }>;
    }>;
  };
}

export interface TicketModalSubmitInteraction {
  data?: {
    components?: Array<{
      components?: Array<{
        custom_id?: string;
        value?: unknown;
      }>;
    }>;
  };
}

export interface TicketTranscriptMessage {
  authorId: string;
  authorTag: string | null;
  content: string;
  createdAtMs: number;
}

export function buildTicketOpenCustomId(ticketTypeId: string): string {
  return `${TICKET_OPEN_CUSTOM_ID_PREFIX}${ticketTypeId}`;
}

export function buildTicketCloseCustomId(channelId: string): string {
  return `${TICKET_CLOSE_CUSTOM_ID_PREFIX}${channelId}`;
}

export function parseTicketCustomId(
  customId: string
): { action: "open"; ticketTypeId: string } | { action: "close"; channelId: string } | null {
  if (customId.startsWith(TICKET_OPEN_CUSTOM_ID_PREFIX)) {
    return {
      action: "open",
      ticketTypeId: customId.slice(TICKET_OPEN_CUSTOM_ID_PREFIX.length),
    };
  }

  if (customId.startsWith(TICKET_CLOSE_CUSTOM_ID_PREFIX)) {
    return {
      action: "close",
      channelId: customId.slice(TICKET_CLOSE_CUSTOM_ID_PREFIX.length),
    };
  }

  return null;
}

export function buildTicketModalResponse(ticketType: TicketTypeConfig): TicketModalResponse {
  return {
    type: 9,
    data: {
      custom_id: buildTicketOpenCustomId(ticketType.id),
      title: ticketType.label,
      components: ticketType.questions.map((question) => ({
        type: 1,
        components: [buildTicketTextInput(question)],
      })),
    },
  };
}

export function buildTicketChannelName(prefix: string, openerUserId: string): string {
  return `${prefix}-${openerUserId}`;
}

export function extractTicketAnswersFromModal(
  interaction: TicketModalSubmitInteraction,
  questions: TicketQuestion[]
): Array<{ questionId: string; label: string; value: string }> {
  const valuesByCustomId = new Map<string, string>();

  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (typeof component.custom_id === "string" && typeof component.value === "string") {
        valuesByCustomId.set(component.custom_id, component.value);
      }
    }
  }

  return questions.map((question) => ({
    questionId: question.id,
    label: question.label,
    value: valuesByCustomId.get(question.id) ?? "",
  }));
}

export function renderTicketTranscript(
  instance: TicketInstance,
  messages: TicketTranscriptMessage[]
): string {
  const lines: string[] = [];
  const sortedMessages = [...messages].sort((left, right) => left.createdAtMs - right.createdAtMs);

  lines.push("# Ticket Transcript");
  lines.push(`Guild: ${instance.guildId}`);
  lines.push(`Ticket Type: ${instance.ticketTypeLabel} (${instance.ticketTypeId})`);
  lines.push(`Channel: ${instance.channelId}`);
  lines.push(`Opened by: ${instance.openerUserId}`);
  lines.push(`Support Role: ${instance.supportRoleId ?? "Not configured"}`);
  lines.push(`Status: ${instance.status}`);
  lines.push(`Opened at: ${new Date(instance.openedAtMs).toISOString()}`);
  lines.push(
    `Closed at: ${instance.closedAtMs === null ? "Not closed" : new Date(instance.closedAtMs).toISOString()}`
  );
  lines.push(`Closed by: ${instance.closedByUserId ?? "Not closed"}`);
  lines.push("");
  lines.push("## Answers");

  if (instance.answers.length === 0) {
    lines.push("_No answers provided._");
  } else {
    for (const answer of instance.answers) {
      lines.push(`- ${answer.label}: ${answer.value}`);
    }
  }

  lines.push("");
  lines.push("## Messages");

  if (sortedMessages.length === 0) {
    lines.push("_No messages captured._");
  } else {
    for (const message of sortedMessages) {
      const author = message.authorTag ?? message.authorId;
      lines.push(
        `[${new Date(message.createdAtMs).toISOString()}] ${author}: ${message.content}`
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function buildTicketTextInput(question: TicketQuestion) {
  return {
    type: 4 as const,
    custom_id: question.id,
    label: question.label,
    style: question.style === "paragraph" ? (2 as const) : (1 as const),
    placeholder: question.placeholder ?? undefined,
    required: question.required,
  };
}
