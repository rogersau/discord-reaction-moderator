/**
 * Discord Reaction Moderator - Cloudflare Worker
 *
 * Receives Discord webhook events for message reactions and removes
 * reactions that match the configured blocklist.
 *
 * Setup:
 * 1. Create a Discord application and bot at https://discord.com/developers
 * 2. Enable Message Content Intent and Server Member Intent
 * 3. Add a webhook to your bot's settings
 * 4. Point the webhook to this worker's URL (e.g., https://your-worker.your-subdomain.workers.dev)
 * 5. Configure wrangler secrets:
 *    wrangler secret put DISCORD_BOT_TOKEN
 *    wrangler secret put DISCORD_PUBLIC_KEY
 * 6. Update wrangler.toml with your KV namespace ID and bot user ID
 */

import { verifyDiscordSignature, deleteReaction } from "./discord";
import {
  getBlocklistFromStore,
  isEmojiBlocked,
  normalizeEmoji,
} from "./blocklist";
import { GatewaySessionDO } from "./durable-objects/gateway-session";
import { ModerationStoreDO } from "./durable-objects/moderation-store";
import type { Env } from "./env";
import type {
  DiscordWebhookPayload,
  DiscordReaction,
} from "./types";

export { GatewaySessionDO, ModerationStoreDO };

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    // Admin endpoint to view/update blocklist
    if (url.pathname === "/admin/blocklist") {
      return handleAdminRequest(request, env);
    }

    if (
      url.pathname === "/admin/gateway/status" ||
      url.pathname === "/admin/gateway/start"
    ) {
      return handleGatewayAdminRequest(request, env);
    }

    // Verify Discord webhook signature
    const signature = request.headers.get("x-signature-ed25519") ?? "";
    const timestamp = request.headers.get("x-signature-timestamp") ?? "";

    if (!signature || !timestamp) {
      return new Response("Missing signature headers", { status: 401 });
    }

    const body = await request.text();

    const isValid = await verifyDiscordSignature(
      body,
      signature,
      timestamp,
      env.DISCORD_PUBLIC_KEY
    );

    if (!isValid) {
      console.error("Invalid request signature");
      return new Response("Invalid signature", { status: 401 });
    }

    // Parse the webhook payload
    let payload: DiscordWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // Handle reaction events
    if (payload.t === "MESSAGE_REACTION_ADD") {
      await handleReactionAdd(payload.d, env);
    }

    // Discord expects a 200 response quickly to acknowledge receipt
    return new Response("", { status: 200 });
  },
};

/**
 * Handle a reaction add event.
 */
async function handleReactionAdd(
  reaction: DiscordReaction | null,
  env: Env
): Promise<void> {
  if (!reaction) return;

  const emojiName = normalizeEmoji(reaction.emoji.name);

  // Build the emoji identifier for comparison
  let emojiId: string;
  if (reaction.emoji.id && reaction.emoji.name) {
    // Custom emoji: name:id
    emojiId = `${reaction.emoji.name}:${reaction.emoji.id}`;
  } else if (emojiName) {
    emojiId = emojiName;
  } else {
    return;
  }

  // Check if this emoji is blocked
  let blocklist;
  try {
    blocklist = await getBlocklistFromStore(() =>
      getModerationStoreStub(env).fetch("https://moderation-store/config")
    );
  } catch (error) {
    console.error("Failed to load moderation config", error);
    return;
  }

  // Ignore reactions from the bot itself
  if (reaction.user_id === blocklist.botUserId) {
    return;
  }

  if (!isEmojiBlocked(emojiId, blocklist, reaction.guild_id)) {
    return;  // Not blocked, ignore
  }

  // Delete the reaction
  try {
    await deleteReaction(
      reaction.channel_id,
      reaction.message_id,
      reaction.emoji,
      reaction.user_id,
      env.DISCORD_BOT_TOKEN
    );

    console.log(
      `Removed reaction ${emojiId} from message ${reaction.message_id} in channel ${reaction.channel_id}`
    );
  } catch (err) {
    console.error(`Failed to remove reaction:`, err);
    // Don't throw - Discord expects 200 quickly
  }
}

/**
 * Admin endpoint for managing the blocklist.
 * Uses optional bearer token auth when ADMIN_AUTH_SECRET is configured.
 */
async function handleAdminRequest(request: Request, env: Env): Promise<Response> {
  if (!isAuthorizedAdminRequest(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const method = request.method;
  const storeStub = getModerationStoreStub(env);

  if (method === "GET") {
    return storeStub.fetch("https://moderation-store/config");
  }

  if (method === "POST" || method === "PUT") {
    return storeStub.fetch("https://moderation-store/emoji", {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
    });
  }

  return new Response("Method not allowed", { status: 405 });
}

function getModerationStoreStub(env: Env): DurableObjectStub {
  const storeId = env.MODERATION_STORE_DO.idFromName("moderation-store");
  return env.MODERATION_STORE_DO.get(storeId);
}

async function handleGatewayAdminRequest(
  request: Request,
  env: Env
): Promise<Response> {
  if (!isAuthorizedAdminRequest(request, env)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const gatewayStub = getGatewaySessionStub(env);
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/admin/gateway/status") {
    return gatewayStub.fetch("https://gateway-session/status");
  }

  if (request.method === "POST" && url.pathname === "/admin/gateway/start") {
    return gatewayStub.fetch("https://gateway-session/start", { method: "POST" });
  }

  return new Response("Method not allowed", { status: 405 });
}

function getGatewaySessionStub(env: Env): DurableObjectStub {
  const gatewayId = env.GATEWAY_SESSION_DO.idFromName("gateway-session");
  return env.GATEWAY_SESSION_DO.get(gatewayId);
}

function isAuthorizedAdminRequest(request: Request, env: Env): boolean {
  if (!env.ADMIN_AUTH_SECRET) {
    return true;
  }

  const authorization = request.headers.get("Authorization");
  return authorization === `Bearer ${env.ADMIN_AUTH_SECRET}`;
}
