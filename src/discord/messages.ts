import type { DiscordReaction } from "../types";
import { DISCORD_API, discordRequest, parseDiscordJson } from "./client";

export interface CreateChannelMessageInput {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
  components?: unknown[];
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedFooter {
  text: string;
}

export interface DiscordAllowedMentions {
  parse?: Array<"roles" | "users" | "everyone">;
  roles?: string[];
  users?: string[];
  replied_user?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: DiscordEmbedFooter;
  timestamp?: string;
}

export interface DiscordMessageResource {
  id: string;
  channel_id: string;
  content: string;
}

export interface DiscordMessageAttachmentResource {
  id: string;
  filename: string;
  description?: string | null;
  content_type?: string | null;
  size?: number;
  url: string;
  proxy_url?: string;
  height?: number | null;
  width?: number | null;
}

export interface DiscordMessageListItem extends DiscordMessageResource {
  timestamp: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    global_name: string | null;
  };
  member?: {
    nick?: string | null;
  };
  attachments?: DiscordMessageAttachmentResource[];
}

export async function createChannelMessage(
  channelId: string,
  body: CreateChannelMessageInput,
  botToken: string,
): Promise<DiscordMessageResource> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return await parseDiscordJson<DiscordMessageResource>(
    response,
    "Failed to create channel message",
  );
}

export async function editChannelMessage(
  channelId: string,
  messageId: string,
  body: CreateChannelMessageInput,
  botToken: string,
): Promise<DiscordMessageResource> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return await parseDiscordJson<DiscordMessageResource>(response, "Failed to edit channel message");
}

export async function deleteChannelMessage(
  channelId: string,
  messageId: string,
  botToken: string,
): Promise<void> {
  await discordRequest(
    `${DISCORD_API}/channels/${channelId}/messages/${messageId}`,
    "DELETE",
    botToken,
  );
}

export async function createUserDmChannel(
  userId: string,
  botToken: string,
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
  });

  return await parseDiscordJson<{ id: string }>(response, "Failed to create DM channel");
}

export async function createUserDmMessage(
  userId: string,
  body: CreateChannelMessageInput,
  botToken: string,
): Promise<DiscordMessageResource> {
  const dmChannel = await createUserDmChannel(userId, botToken);
  return createChannelMessage(dmChannel.id, body, botToken);
}

export async function listChannelMessages(
  channelId: string,
  botToken: string,
  options?: { before?: string; limit?: number },
): Promise<DiscordMessageListItem[]> {
  const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
  url.searchParams.set("limit", String(options?.limit ?? 50));
  if (options?.before) {
    url.searchParams.set("before", options.before);
  }

  const response = await discordRequest(url.toString(), "GET", botToken);
  return await parseDiscordJson<DiscordMessageListItem[]>(
    response,
    "Failed to list channel messages",
  );
}

export async function deleteChannel(channelId: string, botToken: string): Promise<void> {
  await discordRequest(`${DISCORD_API}/channels/${channelId}`, "DELETE", botToken);
}

export async function uploadTranscriptToChannel(
  channelId: string,
  filename: string,
  transcriptBody: string,
  botToken: string,
  options?: {
    htmlTranscriptUrl?: string;
    embeds?: DiscordEmbed[];
  },
): Promise<DiscordMessageResource> {
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: options?.htmlTranscriptUrl
        ? `HTML transcript: ${options.htmlTranscriptUrl}`
        : undefined,
      embeds: options?.embeds,
      attachments: [{ id: 0, filename }],
    }),
  );
  form.set("files[0]", new File([transcriptBody], filename, { type: "text/plain" }));

  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: form,
  });

  return await parseDiscordJson<DiscordMessageResource>(response, "Failed to upload transcript");
}

export async function deleteReaction(
  channelId: string,
  messageId: string,
  emoji: DiscordReaction["emoji"],
  userId: string,
  botToken: string,
): Promise<void> {
  const encodedEmoji = encodeEmoji(emoji);

  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/${encodeURIComponent(userId)}`;

  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok && response.status !== 204) {
    const error = await response.text().catch(() => "Unknown error");
    console.error(`Failed to delete reaction: ${response.status} - ${error}`);
    throw new Error(`Discord API error: ${response.status}`);
  }
}

function encodeEmoji(emoji: DiscordReaction["emoji"]): string {
  if (emoji.id && emoji.name) {
    return `${emoji.name}:${emoji.id}`;
  } else if (emoji.name) {
    return encodeURIComponent(emoji.name);
  }
  throw new Error("Invalid emoji: no name or id");
}
