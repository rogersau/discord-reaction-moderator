/**
 * Discord Reaction Moderator - Cloudflare Worker
 *
 * Public entry point for health checks, admin APIs, and scheduled gateway bootstrap.
 */

import { GatewaySessionDO } from "./durable-objects/gateway-session";
import { ModerationStoreDO } from "./durable-objects/moderation-store";
import { getBlocklistFromStore, normalizeEmoji } from "./blocklist";
import {
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "./discord-interactions";
import { syncApplicationCommands, verifyDiscordSignature } from "./discord";
import type { Env } from "./env";
import { getModerationStoreStub } from "./reaction-moderation";

export { GatewaySessionDO, ModerationStoreDO };

const DISCORD_INTERACTION_MAX_AGE_SECONDS = 5 * 60;

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

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteractionRequest(request, env);
    }

    return new Response("Not found", { status: 404 });
  },

  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext
  ): void {
    if (!env.DISCORD_BOT_TOKEN) {
      return;
    }

    ctx.waitUntil(bootstrapGatewaySession(env));
  },
};

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
    return bootstrapGatewaySession(env);
  }

  return new Response("Method not allowed", { status: 405 });
}

function startGatewaySession(env: Env): Promise<Response> {
  return getGatewaySessionStub(env).fetch("https://gateway-session/start", {
    method: "POST",
  });
}

async function bootstrapGatewaySession(env: Env): Promise<Response> {
  if (env.DISCORD_APPLICATION_ID) {
    try {
      await syncApplicationCommands(
        env.DISCORD_APPLICATION_ID,
        env.DISCORD_BOT_TOKEN
      );
    } catch (error) {
      console.error("Failed to sync slash commands during bootstrap", error);
    }
  }

  return startGatewaySession(env);
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

function isFreshDiscordTimestamp(timestamp: string): boolean {
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }

  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestampSeconds) <= DISCORD_INTERACTION_MAX_AGE_SECONDS;
}

async function handleInteractionRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!isFreshDiscordTimestamp(timestamp)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const isValid = await verifyDiscordSignature(
    env.DISCORD_PUBLIC_KEY,
    timestamp,
    body,
    signature
  );

  if (!isValid) {
    return new Response("Unauthorized", { status: 401 });
  }

  let interaction: any;
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  if (interaction?.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction?.type === 2) {
    return handleApplicationCommand(interaction, env);
  }

  return Response.json(buildEphemeralMessage("Unsupported interaction type."));
}

async function handleApplicationCommand(
  interaction: any,
  env: Env
): Promise<Response> {
  if (typeof interaction?.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(
      buildEphemeralMessage("This command can only be used inside a server.")
    );
  }

  if (!hasGuildAdminPermission(interaction?.member?.permissions ?? "")) {
    return Response.json(
      buildEphemeralMessage(
        "You need Administrator or Manage Guild permissions to use this command."
      )
    );
  }

  const invocation = extractCommandInvocation(interaction);
  if (!invocation) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

  const normalizedEmoji = normalizeEmoji(invocation.emoji);
  if (!normalizedEmoji) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

  const storeStub = getModerationStoreStub(env);
  let isAlreadyBlocked = false;
  try {
    const config = await getBlocklistFromStore(() =>
      storeStub.fetch("https://moderation-store/config")
    );
    isAlreadyBlocked =
      config.guilds?.[interaction.guild_id]?.emojis.includes(normalizedEmoji) ?? false;
  } catch (error) {
    console.error("Failed to load moderation config", error);
    return Response.json(
      buildEphemeralMessage("Failed to update the server blocklist.")
    );
  }

  if (invocation.subcommandName === "add" && isAlreadyBlocked) {
    return Response.json(
      buildEphemeralMessage(`${invocation.emoji} is already blocked in this server.`)
    );
  }

  if (invocation.subcommandName === "remove" && !isAlreadyBlocked) {
    return Response.json(
      buildEphemeralMessage(`${invocation.emoji} is not currently blocked in this server.`)
    );
  }

  let storeResponse: Response;
  try {
    storeResponse = await storeStub.fetch(
      "https://moderation-store/guild-emoji",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guildId: interaction.guild_id,
          emoji: normalizedEmoji,
          action: invocation.subcommandName,
        }),
      }
    );
  } catch (error) {
    console.error("Guild emoji mutation failed", error);
    return Response.json(
      buildEphemeralMessage("Failed to update the server blocklist.")
    );
  }

  if (!storeResponse.ok) {
    console.error("Guild emoji mutation failed", await storeResponse.text());
    return Response.json(
      buildEphemeralMessage("Failed to update the server blocklist.")
    );
  }

  const actionMessage =
    invocation.subcommandName === "add"
      ? `Blocked ${invocation.emoji} in this server.`
      : `Unblocked ${invocation.emoji} in this server.`;

  return Response.json(buildEphemeralMessage(actionMessage));
}
