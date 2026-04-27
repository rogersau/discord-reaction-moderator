import type { DiscordEmbed } from "./discord";
import type { TicketInstance, TicketPanelConfig, TicketQuestion, TicketTypeConfig } from "./types";

const TICKET_OPEN_CUSTOM_ID_PREFIX = "ticket:open:";
const TICKET_CLOSE_CUSTOM_ID_PREFIX = "ticket:close:";
const TICKET_CLOSE_REQUEST_CUSTOM_ID_PREFIX = "ticket:close-request:";
const TICKET_CLOSE_CONFIRM_CUSTOM_ID_PREFIX = "ticket:close-confirm:";
const TICKET_CLOSE_DECLINE_CUSTOM_ID_PREFIX = "ticket:close-decline:";

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

export interface TicketTranscriptAttachment {
  id: string;
  filename: string;
  url: string;
  proxyUrl: string | null;
  contentType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
}

export interface TicketTranscriptMessage {
  authorId: string;
  authorTag: string | null;
  content: string;
  createdAtMs: number;
  attachments?: TicketTranscriptAttachment[];
}

export interface TicketTranscriptPresentationOptions {
  guildName?: string | null;
  channelName?: string | null;
  openerDisplayName?: string | null;
  closerDisplayName?: string | null;
}

interface StoredTicketPanelPayload {
  ticketTypes: TicketTypeConfig[];
  panelTitle?: string | null;
  panelDescription?: string | null;
  panelFooter?: string | null;
}

export function buildTicketOpenCustomId(ticketTypeId: string): string {
  return `${TICKET_OPEN_CUSTOM_ID_PREFIX}${ticketTypeId}`;
}

export function serializeTicketPanelStorage(panel: TicketPanelConfig): string {
  return JSON.stringify({
    ticketTypes: panel.ticketTypes,
    panelTitle: panel.panelTitle,
    panelDescription: panel.panelDescription,
    panelFooter: panel.panelFooter,
  } satisfies StoredTicketPanelPayload);
}

export function parseTicketPanelStorage(
  payload: string
): Pick<TicketPanelConfig, "ticketTypes" | "panelTitle" | "panelDescription" | "panelFooter"> {
  const parsed = JSON.parse(payload) as unknown;

  if (Array.isArray(parsed)) {
    return {
      ticketTypes: parsed as TicketTypeConfig[],
      panelTitle: null,
      panelDescription: null,
      panelFooter: null,
    };
  }

  if (isRecord(parsed) && Array.isArray(parsed.ticketTypes)) {
    return {
      ticketTypes: parsed.ticketTypes as TicketTypeConfig[],
      panelTitle: asStoredNullableString(parsed.panelTitle),
      panelDescription: asStoredNullableString(parsed.panelDescription),
      panelFooter: asStoredNullableString(parsed.panelFooter),
    };
  }

  throw new Error("Invalid stored ticket panel payload");
}

export function buildTicketCloseCustomId(channelId: string): string {
  return `${TICKET_CLOSE_CUSTOM_ID_PREFIX}${channelId}`;
}

export function buildTicketCloseRequestCustomId(channelId: string): string {
  return `${TICKET_CLOSE_REQUEST_CUSTOM_ID_PREFIX}${channelId}`;
}

export function buildTicketCloseConfirmCustomId(channelId: string): string {
  return `${TICKET_CLOSE_CONFIRM_CUSTOM_ID_PREFIX}${channelId}`;
}

export function buildTicketCloseDeclineCustomId(channelId: string): string {
  return `${TICKET_CLOSE_DECLINE_CUSTOM_ID_PREFIX}${channelId}`;
}

export function parseTicketCustomId(
  customId: string
):
  | { action: "open"; ticketTypeId: string }
  | { action: "close"; channelId: string }
  | { action: "close-request"; channelId: string }
  | { action: "close-confirm"; channelId: string }
  | { action: "close-decline"; channelId: string }
  | null {
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

  if (customId.startsWith(TICKET_CLOSE_REQUEST_CUSTOM_ID_PREFIX)) {
    return {
      action: "close-request",
      channelId: customId.slice(TICKET_CLOSE_REQUEST_CUSTOM_ID_PREFIX.length),
    };
  }

  if (customId.startsWith(TICKET_CLOSE_CONFIRM_CUSTOM_ID_PREFIX)) {
    return {
      action: "close-confirm",
      channelId: customId.slice(TICKET_CLOSE_CONFIRM_CUSTOM_ID_PREFIX.length),
    };
  }

  if (customId.startsWith(TICKET_CLOSE_DECLINE_CUSTOM_ID_PREFIX)) {
    return {
      action: "close-decline",
      channelId: customId.slice(TICKET_CLOSE_DECLINE_CUSTOM_ID_PREFIX.length),
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

export function formatTicketNumber(ticketNumber: number): string {
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) {
    throw new Error("Ticket number must be a positive integer");
  }

  return String(ticketNumber).padStart(3, "0");
}

export function buildTicketChannelName(prefix: string, ticketNumber: number): string {
  const suffix = `-${formatTicketNumber(ticketNumber)}`;
  const normalizedPrefix = normalizeTicketChannelPrefix(prefix);
  const maxPrefixLength = Math.max(1, 100 - suffix.length);
  const trimmedPrefix = normalizedPrefix.slice(0, maxPrefixLength).replace(/-+$/g, "");
  return `${trimmedPrefix.length > 0 ? trimmedPrefix : "ticket"}${suffix}`;
}

export function buildTicketTranscriptStorageKey(guildId: string, channelId: string): string {
  return `${guildId}/${channelId}.html`;
}

export function buildTicketTranscriptAttachmentStorageKey(
  guildId: string,
  channelId: string,
  attachmentId: string,
  filename: string
): string {
  return `${guildId}/${channelId}/attachments/${attachmentId}/${encodeURIComponent(filename)}`;
}

export function buildTicketTranscriptPath(guildId: string, channelId: string): string {
  return `/transcripts/${encodeURIComponent(guildId)}/${encodeURIComponent(channelId)}`;
}

export function buildTicketTranscriptAttachmentPath(
  guildId: string,
  channelId: string,
  attachmentId: string,
  filename: string
): string {
  return `${buildTicketTranscriptPath(guildId, channelId)}/media/${encodeURIComponent(attachmentId)}/${encodeURIComponent(filename)}`;
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
      const content = message.content.length > 0 ? message.content : "[no text content]";
      lines.push(
        `[${new Date(message.createdAtMs).toISOString()}] ${author}: ${content}`
      );
      for (const attachment of message.attachments ?? []) {
        lines.push(formatTranscriptAttachmentTextLine(attachment));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderTicketTranscriptHtml(
  instance: TicketInstance,
  messages: TicketTranscriptMessage[],
  options: TicketTranscriptPresentationOptions = {}
): string {
  const sortedMessages = [...messages].sort((left, right) => left.createdAtMs - right.createdAtMs);
  const answerMarkup =
    instance.answers.length === 0
      ? '<p class="empty"><em>No answers provided.</em></p>'
      : `<ul class="answers">${instance.answers
          .map(
            (answer) =>
              `<li><strong>${escapeHtml(answer.label)}:</strong> ${escapeHtml(answer.value)}</li>`
          )
          .join("")}</ul>`;
  const messageMarkup =
    sortedMessages.length === 0
      ? '<p class="empty"><em>No messages captured.</em></p>'
      : `<ol class="messages">${sortedMessages
          .map((message) => {
            const author = message.authorTag ?? message.authorId;
            const contentMarkup = message.content.length > 0
              ? `<div class="message-content">${escapeHtml(message.content)}</div>`
              : "";
            const attachmentMarkup = renderTranscriptAttachments(message.attachments ?? []);
            return `<li>
  <header>
    <span class="author">${escapeHtml(author)}</span>
    <time datetime="${new Date(message.createdAtMs).toISOString()}">${new Date(message.createdAtMs).toISOString()}</time>
  </header>
  ${contentMarkup}
  ${attachmentMarkup}
</li>`;
          })
          .join("")}</ol>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Ticket Transcript ${escapeHtml(instance.channelId)}</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    body {
      margin: 0;
      background: #020617;
      color: #e2e8f0;
    }
    main {
      max-width: 960px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1, h2 {
      margin-bottom: 12px;
    }
    .meta, .answers, .messages {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 16px 20px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.35);
    }
    .meta {
      display: grid;
      grid-template-columns: minmax(140px, 200px) 1fr;
      gap: 10px 16px;
      margin-bottom: 24px;
    }
    .meta dt {
      font-weight: 700;
      color: #93c5fd;
    }
    .meta dd {
      margin: 0;
      word-break: break-word;
    }
    .answers, .messages {
      margin: 0;
      padding-left: 24px;
    }
    .messages {
      list-style: none;
      padding-left: 0;
    }
    .messages li {
      padding: 16px 0;
      border-bottom: 1px solid #1e293b;
    }
    .messages li:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .messages header {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin-bottom: 8px;
      align-items: baseline;
    }
    .author {
      font-weight: 700;
      color: #f8fafc;
    }
    time {
      color: #94a3b8;
      font-size: 0.95rem;
    }
    .message-content {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.5;
    }
    .empty {
      color: #94a3b8;
    }
    .attachments {
      display: grid;
      gap: 12px;
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
    }
    .attachment {
      overflow: hidden;
      border: 1px solid #334155;
      border-radius: 8px;
      background: #020617;
    }
    .attachment-preview {
      display: block;
      color: inherit;
      text-decoration: none;
    }
    .attachment img,
    .attachment video {
      display: block;
      max-width: 100%;
      background: #000;
    }
    .attachment img {
      width: auto;
      max-height: 480px;
    }
    .attachment video {
      width: 100%;
      max-height: 520px;
    }
    .attachment-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      padding: 10px 12px;
      color: #cbd5e1;
      font-size: 0.95rem;
    }
    .attachment-filename {
      color: #f8fafc;
      font-weight: 700;
    }
    .attachment-meta a {
      color: #93c5fd;
    }
  </style>
</head>
<body>
  <main>
    <h1>Ticket Transcript</h1>
    <dl class="meta">
      <dt>Guild</dt><dd>${escapeHtml(formatTranscriptGuildLabel(instance, options))}</dd>
      <dt>Ticket Type</dt><dd>${escapeHtml(instance.ticketTypeLabel)} (${escapeHtml(instance.ticketTypeId)})</dd>
      <dt>Channel</dt><dd>${escapeHtml(formatTranscriptChannelLabel(instance, options))}</dd>
      <dt>Opened by</dt><dd>${escapeHtml(formatTranscriptIdentity(options.openerDisplayName, instance.openerUserId))}</dd>
      <dt>Support Role</dt><dd>${escapeHtml(instance.supportRoleId ?? "Not configured")}</dd>
      <dt>Status</dt><dd>${escapeHtml(instance.status)}</dd>
      <dt>Opened at</dt><dd>${escapeHtml(new Date(instance.openedAtMs).toISOString())}</dd>
      <dt>Closed at</dt><dd>${escapeHtml(instance.closedAtMs === null ? "Not closed" : new Date(instance.closedAtMs).toISOString())}</dd>
      <dt>Closed by</dt><dd>${escapeHtml(formatTranscriptIdentity(options.closerDisplayName, instance.closedByUserId))}</dd>
    </dl>

    <h2>Answers</h2>
    ${answerMarkup}

    <h2>Messages</h2>
    ${messageMarkup}
  </main>
</body>
</html>
`;
}

export function buildTicketTranscriptSummaryEmbed(
  instance: TicketInstance,
  messages: TicketTranscriptMessage[],
  options: TicketTranscriptPresentationOptions = {}
): DiscordEmbed {
  const sortedMessages = [...messages].sort((left, right) => left.createdAtMs - right.createdAtMs);
  const participantLines = summarizeTranscriptParticipants(sortedMessages)
    .map((participant) => `${participant.messageCount} - ${participant.displayName}`)
    .join("\n");
  const attachmentCount = sortedMessages.reduce(
    (total, message) => total + (message.attachments?.length ?? 0),
    0
  );
  const searchKeys = buildTicketTranscriptSearchKeys(instance);
  const fields = [
    {
      name: "Server",
      value: truncateDiscordFieldValue(formatTranscriptGuildLabel(instance, options)),
      inline: false,
    },
    {
      name: "Channel",
      value: truncateDiscordFieldValue(formatTranscriptChannelLabel(instance, options)),
      inline: false,
    },
    {
      name: "Type",
      value: truncateDiscordFieldValue(`${instance.ticketTypeLabel} (${instance.ticketTypeId})`),
      inline: true,
    },
    {
      name: "Messages",
      value: String(sortedMessages.length),
      inline: true,
    },
    ...(attachmentCount > 0
      ? [
          {
            name: "Attachments",
            value: String(attachmentCount),
            inline: true,
          },
        ]
      : []),
    ...(searchKeys.length > 0
      ? [
          {
            name: "Search keys",
            value: truncateDiscordFieldValue(searchKeys.join(" ")),
            inline: false,
          },
        ]
      : []),
    {
      name: "Ticket Owner",
      value: truncateDiscordFieldValue(formatTranscriptIdentity(options.openerDisplayName, instance.openerUserId)),
      inline: false,
    },
    ...instance.answers
      .filter((answer) => answer.value.trim().length > 0)
      .map((answer) => ({
        name: truncateDiscordFieldName(answer.label),
        value: truncateDiscordFieldValue(answer.value),
        inline: true,
      })),
    ...(participantLines.length > 0
      ? [
          {
            name: "Users in transcript",
            value: truncateDiscordFieldValue(participantLines),
            inline: false,
          },
        ]
      : []),
    {
      name: "Closed by",
      value: truncateDiscordFieldValue(formatTranscriptIdentity(options.closerDisplayName, instance.closedByUserId)),
      inline: false,
    },
  ].slice(0, 25);

  return {
    title: "Ticket Transcript",
    color: 5_763_719,
    fields,
    timestamp: new Date(instance.closedAtMs ?? instance.openedAtMs).toISOString(),
  };
}

function renderTranscriptAttachments(attachments: TicketTranscriptAttachment[]): string {
  if (attachments.length === 0) {
    return "";
  }

  return `<ul class="attachments">${attachments.map(renderTranscriptAttachment).join("")}</ul>`;
}

function renderTranscriptAttachment(attachment: TicketTranscriptAttachment): string {
  const safeUrl = getSafeAttachmentUrl(attachment);
  const filename = attachment.filename.trim().length > 0 ? attachment.filename : "attachment";
  const escapedFilename = escapeHtml(filename);
  const details = formatTranscriptAttachmentDetails(attachment);
  const detailMarkup = details.length > 0 ? `<span>${escapeHtml(details)}</span>` : "";
  const kind = getTranscriptAttachmentKind(attachment);
  const previewMarkup = safeUrl ? renderTranscriptAttachmentPreview(attachment, safeUrl, kind) : "";
  const linkMarkup = safeUrl
    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open attachment</a>`
    : "<span>Attachment URL unavailable</span>";

  return `<li class="attachment attachment-${kind}">
  ${previewMarkup}
  <div class="attachment-meta">
    <span class="attachment-filename">${escapedFilename}</span>
    <span>${formatTranscriptAttachmentKind(kind)}</span>
    ${detailMarkup}
    ${linkMarkup}
  </div>
</li>`;
}

function renderTranscriptAttachmentPreview(
  attachment: TicketTranscriptAttachment,
  safeUrl: string,
  kind: TranscriptAttachmentKind
): string {
  const escapedUrl = escapeHtml(safeUrl);
  const escapedFilename = escapeHtml(attachment.filename.trim().length > 0 ? attachment.filename : "attachment");

  if (kind === "image") {
    return `<a class="attachment-preview" href="${escapedUrl}" target="_blank" rel="noopener noreferrer"><img src="${escapedUrl}" alt="${escapedFilename}" loading="lazy" /></a>`;
  }

  if (kind === "video") {
    const contentType = attachment.contentType ? ` type="${escapeHtml(attachment.contentType)}"` : "";
    return `<video controls preload="metadata"><source src="${escapedUrl}"${contentType} /></video>`;
  }

  return "";
}

function formatTranscriptAttachmentTextLine(attachment: TicketTranscriptAttachment): string {
  const kind = getTranscriptAttachmentKind(attachment);
  const filename = attachment.filename.trim().length > 0 ? attachment.filename : "attachment";
  const details = formatTranscriptAttachmentDetails(attachment);
  const safeUrl = getSafeAttachmentUrl(attachment);
  return `  ${formatTranscriptAttachmentKind(kind)}: ${filename}${details ? ` (${details})` : ""}${safeUrl ? ` - ${safeUrl}` : " - URL unavailable"}`;
}

type TranscriptAttachmentKind = "image" | "video" | "file";

function getTranscriptAttachmentKind(attachment: TicketTranscriptAttachment): TranscriptAttachmentKind {
  const contentType = attachment.contentType?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) {
    return "image";
  }

  if (contentType.startsWith("video/")) {
    return "video";
  }

  const filename = attachment.filename.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(filename)) {
    return "image";
  }

  if (/\.(mp4|webm|mov|m4v|ogg|ogv)$/.test(filename)) {
    return "video";
  }

  return "file";
}

function formatTranscriptAttachmentKind(kind: TranscriptAttachmentKind): string {
  switch (kind) {
    case "image":
      return "Image";
    case "video":
      return "Video";
    case "file":
    default:
      return "Attachment";
  }
}

function formatTranscriptAttachmentDetails(attachment: TicketTranscriptAttachment): string {
  return [attachment.contentType, formatBytes(attachment.size)]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(", ");
}

function formatBytes(size: number | null): string | null {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
    return null;
  }

  if (size < 1024) {
    return `${size} B`;
  }

  const units = ["KB", "MB", "GB"];
  let value = size / 1024;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      const formatted = value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
      return `${formatted} ${unit}`;
    }
    value /= 1024;
  }

  return null;
}

function getSafeAttachmentUrl(attachment: TicketTranscriptAttachment): string | null {
  try {
    const parsedUrl = new URL(attachment.url);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
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

function formatTranscriptGuildLabel(
  instance: TicketInstance,
  options: TicketTranscriptPresentationOptions
): string {
  if (options.guildName && options.guildName !== instance.guildId) {
    return `${options.guildName} (${instance.guildId})`;
  }

  return instance.guildId;
}

function formatTranscriptChannelLabel(
  instance: TicketInstance,
  options: TicketTranscriptPresentationOptions
): string {
  if (options.channelName && options.channelName !== instance.channelId) {
    return `#${options.channelName} (${instance.channelId})`;
  }

  return instance.channelId;
}

function formatTranscriptIdentity(displayName: string | null | undefined, userId: string | null): string {
  if (!userId) {
    return "Not closed";
  }

  if (displayName && displayName !== userId) {
    return `${displayName} (${userId})`;
  }

  return displayName ?? userId;
}

function summarizeTranscriptParticipants(messages: TicketTranscriptMessage[]): Array<{
  authorId: string;
  displayName: string;
  messageCount: number;
}> {
  const participants = new Map<string, { displayName: string; messageCount: number }>();

  for (const message of messages) {
    const existing = participants.get(message.authorId);
    const displayName = message.authorTag ?? message.authorId;
    if (existing) {
      existing.messageCount += 1;
      continue;
    }

    participants.set(message.authorId, {
      displayName,
      messageCount: 1,
    });
  }

  return [...participants.entries()]
    .map(([authorId, participant]) => ({ authorId, ...participant }))
    .sort((left, right) => right.messageCount - left.messageCount || left.displayName.localeCompare(right.displayName));
}

function buildTicketTranscriptSearchKeys(instance: TicketInstance): string[] {
  const keys = new Set<string>([`discord:${instance.openerUserId}`]);

  for (const answer of instance.answers) {
    const normalizedKey = canonicalizeSearchKey(normalizeSearchKey(answer.questionId || answer.label));
    const normalizedValue = answer.value.trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }

    if (!/^(discord|steam|steam64|userid|id)$/.test(normalizedKey)) {
      continue;
    }

    if (/\s/.test(normalizedValue)) {
      continue;
    }

    keys.add(`${normalizedKey}:${normalizedValue}`);
  }

  return [...keys];
}

function normalizeSearchKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function canonicalizeSearchKey(value: string): string {
  if (value.includes("discord")) {
    return "discord";
  }

  if (value.includes("steam64")) {
    return "steam64";
  }

  if (value.includes("steam")) {
    return "steam";
  }

  if (value === "userid64") {
    return "userid";
  }

  return value;
}

function truncateDiscordFieldName(value: string): string {
  return value.length <= 256 ? value : `${value.slice(0, 253)}...`;
}

function truncateDiscordFieldValue(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1021)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asStoredNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  return value.trim().length > 0 ? value : null;
}

function normalizeTicketChannelPrefix(prefix: string): string {
  return prefix
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "ticket";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
