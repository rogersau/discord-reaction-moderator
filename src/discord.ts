// Discord API helpers

import { SLASH_COMMAND_DEFINITIONS } from "./discord-commands";
import type { DiscordReaction } from "./types";

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

export interface GuildTicketResources {
  channels: DiscordChannelResource[];
  roles: DiscordRoleResource[];
}

export interface DiscordCurrentUserGuild {
  id: string;
  name: string;
}

export interface CreateTicketChannelInput {
  guildId: string;
  name: string;
  parentId: string | null;
  botUserId: string;
  openerUserId: string;
  supportRoleId: string;
}

export interface CreateChannelMessageInput {
  content?: string;
  embeds?: DiscordEmbed[];
  allowed_mentions?: DiscordAllowedMentions;
}

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedFooter {
  text: string;
}

export interface DiscordChannelResource {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
}

export interface DiscordRoleResource {
  id: string;
  name: string;
  permissions: string;
  position: number;
}

export interface DiscordPermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface DiscordGuildMemberResource {
  user?: {
    id: string;
  };
  roles: string[];
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
}

export function assertValidDiscordPublicKey(publicKeyHex: string): string {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex)) {
    throw new Error("DISCORD_PUBLIC_KEY must be a 64-character hex string");
  }
  return publicKeyHex;
}

export async function verifyDiscordSignature(
  publicKeyHex: string,
  timestamp: string,
  body: string,
  signatureHex: string
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBuffer(publicKeyHex),
      "Ed25519",
      false,
      ["verify"]
    );

    return crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBuffer(signatureHex),
      new TextEncoder().encode(`${timestamp}${body}`)
    );
  } catch {
    return false;
  }
}

export async function syncApplicationCommands(
  applicationId: string,
  botToken: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/applications/${applicationId}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(SLASH_COMMAND_DEFINITIONS),
    }
  );

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new Error(`Failed to sync application commands: ${response.status} ${error}`);
  }
}

export async function listGuildTicketResources(
  guildId: string,
  botToken: string
): Promise<GuildTicketResources> {
  const [channels, roles] = await Promise.all([
    discordGetJson<DiscordChannelResource[]>(`${DISCORD_API}/guilds/${guildId}/channels`, botToken),
    discordGetJson<DiscordRoleResource[]>(`${DISCORD_API}/guilds/${guildId}/roles`, botToken),
  ]);

  return {
    channels,
    roles,
  };
}

export async function listBotGuilds(
  botToken: string
): Promise<Array<{ guildId: string; name: string }>> {
  const guilds = await discordGetJson<DiscordCurrentUserGuild[]>(
    `${DISCORD_API}/users/@me/guilds`,
    botToken
  );

  return guilds.map(({ id, name }) => ({
    guildId: id,
    name,
  }));
}

export async function getGuildPermissionResources(
  guildId: string,
  botUserId: string,
  botToken: string
): Promise<{
  channels: DiscordChannelResource[];
  roles: DiscordRoleResource[];
  member: DiscordGuildMemberResource;
}> {
  const [channels, roles, member] = await Promise.all([
    discordGetJson<DiscordChannelResource[]>(`${DISCORD_API}/guilds/${guildId}/channels`, botToken),
    discordGetJson<DiscordRoleResource[]>(`${DISCORD_API}/guilds/${guildId}/roles`, botToken),
    discordGetJson<DiscordGuildMemberResource>(`${DISCORD_API}/guilds/${guildId}/members/${botUserId}`, botToken),
  ]);

  return {
    channels,
    roles,
    member,
  };
}

export async function createTicketChannel(
  input: CreateTicketChannelInput,
  botToken: string
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/guilds/${input.guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      type: 0,
      parent_id: input.parentId ?? undefined,
      permission_overwrites: [
        {
          id: input.guildId,
          type: 0,
          deny: "1024",
          allow: "0",
        },
        {
          id: input.botUserId,
          type: 1,
          allow: "1024",
          deny: "0",
        },
        {
          id: input.openerUserId,
          type: 1,
          allow: "1024",
          deny: "0",
        },
        {
          id: input.supportRoleId,
          type: 0,
          allow: "1024",
          deny: "0",
        },
      ],
    }),
  });

  return await parseDiscordJson<{ id: string }>(response, "Failed to create ticket channel");
}

export async function createChannelMessage(
  channelId: string,
  body: CreateChannelMessageInput,
  botToken: string
): Promise<DiscordMessageResource> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return await parseDiscordJson<DiscordMessageResource>(response, "Failed to create channel message");
}

export async function listChannelMessages(
  channelId: string,
  botToken: string,
  options?: { before?: string; limit?: number }
): Promise<DiscordMessageListItem[]> {
  const url = new URL(`${DISCORD_API}/channels/${channelId}/messages`);
  url.searchParams.set("limit", String(options?.limit ?? 50));
  if (options?.before) {
    url.searchParams.set("before", options.before);
  }

  const response = await discordRequest(
    url.toString(),
    "GET",
    botToken
  );
  return await parseDiscordJson<DiscordMessageListItem[]>(
    response,
    "Failed to list channel messages"
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
  }
): Promise<DiscordMessageResource> {
  const form = new FormData();
  form.set(
    "payload_json",
    JSON.stringify({
      content: options?.htmlTranscriptUrl ? `HTML transcript: ${options.htmlTranscriptUrl}` : undefined,
      embeds: options?.embeds,
      attachments: [{ id: 0, filename }],
    })
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

/**
 * Delete a reaction from a message.
 * Requires the bot to have MANAGE_MESSAGES permission in the channel.
 */
export async function deleteReaction(
  channelId: string,
  messageId: string,
  emoji: DiscordReaction["emoji"],
  userId: string,
  botToken: string
): Promise<void> {
  // Encode emoji for URL - handle both custom and unicode emojis
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

export async function addGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  await mutateGuildMemberRole("PUT", guildId, userId, roleId, botToken);
}

export async function removeGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  await mutateGuildMemberRole("DELETE", guildId, userId, roleId, botToken);
}

/**
 * Encode an emoji for use in Discord API URLs.
 * Custom emojis: name:id format
 * Unicode emojis: URL-encoded
 */
function encodeEmoji(emoji: DiscordReaction["emoji"]): string {
  if (emoji.id && emoji.name) {
    // Custom emoji: name:id format
    return `${emoji.name}:${emoji.id}`;
  } else if (emoji.name) {
    // Unicode emoji: needs URL encoding
    return encodeURIComponent(emoji.name);
  }
  throw new Error("Invalid emoji: no name or id");
}

async function mutateGuildMemberRole(
  method: "PUT" | "DELETE",
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Discord API error: ${response.status} ${error}`,
      response.status,
      error
    );
  }
}

async function discordRequest(url: string, method: string, botToken: string): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(`Discord API error: ${response.status} ${error}`, response.status, error);
  }

  return response;
}

async function discordGetJson<T>(url: string, botToken: string): Promise<T> {
  const response = await discordRequest(url, "GET", botToken);
  return await parseDiscordJson<T>(response, "Failed to parse Discord response");
}

async function parseDiscordJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(`${message}: ${response.status} ${error}`, response.status, error);
  }

  return (await response.json()) as T;
}

function hexToBuffer(hex: string): ArrayBuffer {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error("Invalid hex input");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
