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
