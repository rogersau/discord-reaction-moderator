// Discord API helpers

import type { DiscordReaction } from "./types";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Delete a reaction from a message.
 * Requires the bot to have MANAGE_MESSAGES permission in the channel.
 */
export async function deleteReaction(
  channelId: string,
  messageId: string,
  emoji: DiscordReaction["emoji"],
  botToken: string
): Promise<void> {
  // Encode emoji for URL - handle both custom and unicode emojis
  const encodedEmoji = encodeEmoji(emoji);

  const url = `${DISCORD_API}/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;

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

/**
 * Verify a Discord webhook request signature.
 * Discord signs requests with their public key using ECDSA (Ed25519).
 */
export async function verifyDiscordSignature(
  body: string,
  signature: string,
  timestamp: string,
  publicKeyHex: string
): Promise<boolean> {
  // Convert hex public key to Uint8Array
  const publicKeyBytes = hexToBytes(publicKeyHex);

  // Create the signed payload: timestamp + body
  const encoder = new TextEncoder();
  const signedPayload = encoder.encode(timestamp + body);

  // Decode the signature from hex
  const signatureBytes = hexToBytes(signature);

  // Use WebCrypto to verify the signature
  // Discord uses P-256 (secp256r1), not Ed25519
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      {
        name: "ECDSA",
        namedCurve: "P-256",
      },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify(
      {
        name: "ECDSA",
        hash: "SHA-256",
      },
      cryptoKey,
      signatureBytes,
      signedPayload
    );

    return isValid;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}
