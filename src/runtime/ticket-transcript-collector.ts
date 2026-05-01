import { listBotGuilds, listChannelMessages, listGuildTicketResources } from "../discord";
import {
  buildTicketTranscriptAttachmentPath,
  buildTicketTranscriptAttachmentStorageKey,
  buildTicketTranscriptPath,
  buildTicketTranscriptStorageKey,
  renderTicketTranscriptHtml,
  type TicketTranscriptAttachment,
  type TicketTranscriptMessage,
  type TicketTranscriptPresentationOptions,
} from "../tickets";
import type { TicketInstance } from "../types";
import type { TicketTranscriptBlobStore } from "./contracts";

export interface TicketTranscriptArtifacts {
  messages: TicketTranscriptMessage[];
  presentation: TicketTranscriptPresentationOptions;
  htmlUrl?: string;
}

export async function buildTicketTranscriptArtifacts(options: {
  guildId: string;
  channelId: string;
  closingTicket: TicketInstance;
  closerDisplayName: string | null;
  discordBotToken: string;
  requestOrigin: string;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}): Promise<TicketTranscriptArtifacts> {
  const messages = await listAllChannelMessages(options.channelId, options.discordBotToken);
  let transcriptMessages: TicketTranscriptMessage[] = messages.map((message) => ({
    authorId: message.author.id,
    authorTag: resolveDiscordMessageDisplayName(message),
    content: message.content,
    createdAtMs: Date.parse(message.timestamp),
    attachments: mapDiscordMessageAttachments(message),
  }));

  const participantDisplayNames = new Map<string, string>();
  for (const message of transcriptMessages) {
    if (!participantDisplayNames.has(message.authorId)) {
      participantDisplayNames.set(message.authorId, message.authorTag ?? message.authorId);
    }
  }

  let guildName: string | null = null;
  let channelName: string | null = null;
  try {
    const [guilds, guildResources] = await Promise.all([
      listBotGuilds(options.discordBotToken),
      listGuildTicketResources(options.guildId, options.discordBotToken),
    ]);
    guildName = guilds.find((guild) => guild.guildId === options.guildId)?.name ?? null;
    channelName =
      guildResources.channels.find((channel) => channel.id === options.channelId)?.name ?? null;
  } catch (error) {
    console.error("Failed to resolve transcript display metadata", error);
  }

  const presentation = {
    guildName,
    channelName,
    openerDisplayName: participantDisplayNames.get(options.closingTicket.openerUserId) ?? null,
    closerDisplayName:
      options.closerDisplayName ??
      (options.closingTicket.closedByUserId
        ? (participantDisplayNames.get(options.closingTicket.closedByUserId) ?? null)
        : null),
  };
  let htmlUrl: string | undefined;

  if (options.ticketTranscriptBlobs) {
    transcriptMessages = await archiveTicketTranscriptAttachments(
      transcriptMessages,
      options.guildId,
      options.channelId,
      options.requestOrigin,
      options.ticketTranscriptBlobs,
    );
    await options.ticketTranscriptBlobs.putHtml(
      buildTicketTranscriptStorageKey(options.guildId, options.channelId),
      renderTicketTranscriptHtml(options.closingTicket, transcriptMessages, presentation),
    );
    htmlUrl = `${options.requestOrigin}${buildTicketTranscriptPath(options.guildId, options.channelId)}`;
  }

  return {
    messages: transcriptMessages,
    presentation,
    htmlUrl,
  };
}

async function listAllChannelMessages(channelId: string, discordBotToken: string) {
  const messages = [];
  let before: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const batch = await listChannelMessages(channelId, discordBotToken, { before, limit: 100 });
    messages.push(...batch);
    if (batch.length < 100) {
      break;
    }

    before = batch[batch.length - 1]?.id;
    if (!before) {
      break;
    }
  }

  return messages.sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function resolveDiscordMessageDisplayName(message: {
  member?: { nick?: string | null };
  author: { global_name: string | null; username: string };
}): string {
  return message.member?.nick ?? message.author.global_name ?? message.author.username;
}

function mapDiscordMessageAttachments(message: {
  attachments?: unknown;
}): TicketTranscriptAttachment[] {
  if (!Array.isArray(message.attachments)) {
    return [];
  }

  const attachments: TicketTranscriptAttachment[] = [];
  for (const attachment of message.attachments) {
    if (!isRecord(attachment)) {
      continue;
    }

    const id = asOptionalString(attachment.id);
    const filename = asOptionalString(attachment.filename);
    const url = asOptionalString(attachment.url);
    if (!id || !filename || !url) {
      continue;
    }

    attachments.push({
      id,
      filename,
      url,
      proxyUrl: asOptionalString(attachment.proxy_url),
      contentType: normalizeContentType(asOptionalString(attachment.content_type)),
      size: asOptionalFiniteNumber(attachment.size),
      width: asOptionalFiniteNumber(attachment.width),
      height: asOptionalFiniteNumber(attachment.height),
    });
  }

  return attachments;
}

async function archiveTicketTranscriptAttachments(
  messages: TicketTranscriptMessage[],
  guildId: string,
  channelId: string,
  requestOrigin: string,
  ticketTranscriptBlobs: TicketTranscriptBlobStore,
): Promise<TicketTranscriptMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      const attachments = message.attachments ?? [];
      if (attachments.length === 0) {
        return message;
      }

      return {
        ...message,
        attachments: await Promise.all(
          attachments.map((attachment) =>
            archiveTicketTranscriptAttachment(
              attachment,
              guildId,
              channelId,
              requestOrigin,
              ticketTranscriptBlobs,
            ),
          ),
        ),
      };
    }),
  );
}

async function archiveTicketTranscriptAttachment(
  attachment: TicketTranscriptAttachment,
  guildId: string,
  channelId: string,
  requestOrigin: string,
  ticketTranscriptBlobs: TicketTranscriptBlobStore,
): Promise<TicketTranscriptAttachment> {
  const sourceUrl = getHttpUrl(attachment.url);
  if (!sourceUrl) {
    throw new Error(`Ticket attachment ${attachment.id} has an unsupported URL`);
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to archive ticket attachment ${attachment.id}: ${response.status}`);
  }

  const contentType =
    normalizeContentType(response.headers.get("content-type")) ?? attachment.contentType;
  const body = response.body ?? (await response.arrayBuffer());
  await ticketTranscriptBlobs.putAttachment(
    buildTicketTranscriptAttachmentStorageKey(
      guildId,
      channelId,
      attachment.id,
      attachment.filename,
    ),
    body,
    { contentType },
  );

  return {
    ...attachment,
    url: `${requestOrigin}${buildTicketTranscriptAttachmentPath(guildId, channelId, attachment.id, attachment.filename)}`,
    proxyUrl: null,
    contentType,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeContentType(value: string | null): string | null {
  const normalized = value?.split(";")[0]?.trim().toLowerCase() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function getHttpUrl(value: string): string | null {
  try {
    const parsedUrl = new URL(value);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
      return null;
    }

    return parsedUrl.toString();
  } catch {
    return null;
  }
}
