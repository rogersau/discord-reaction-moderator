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
  type CommandInvocation,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "./discord-interactions";
import {
  addGuildMemberRole,
  removeGuildMemberRole,
  syncApplicationCommands,
  verifyDiscordSignature,
} from "./discord";
import type { Env } from "./env";
import { getModerationStoreStub } from "./reaction-moderation";
import { formatTimedRoleExpiry, parseTimedRoleDuration } from "./timed-roles";

export { GatewaySessionDO, ModerationStoreDO };

const DISCORD_INTERACTION_MAX_AGE_SECONDS = 5 * 60;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2_000;

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

  const storeStub = getModerationStoreStub(env);

  if (invocation.commandName === "timedrole") {
    if (invocation.subcommandName === "list") {
      let listResponse: Response;
      try {
        listResponse = await storeStub.fetch(
          `https://moderation-store/timed-roles?guildId=${encodeURIComponent(interaction.guild_id)}`
        );
      } catch (error) {
        console.error("Failed to load timed roles", error);
        return Response.json(buildEphemeralMessage("Failed to load timed roles."));
      }

      if (!listResponse.ok) {
        console.error("Timed role list failed", await listResponse.text());
        return Response.json(buildEphemeralMessage("Failed to load timed roles."));
      }

      const assignments = (await listResponse.json()) as Array<{
        userId: string;
        roleId: string;
        durationInput: string;
        expiresAtMs: number;
      }>;
      const content =
        assignments.length === 0
          ? "No timed roles are active in this server."
          : `Active timed roles:\n${assignments
              .map(
                (entry) =>
                  `- <@${entry.userId}> -> <@&${entry.roleId}> (${entry.durationInput}, expires ${formatTimedRoleExpiry(entry.expiresAtMs)})`
              )
              .join("\n")}`;

      return Response.json(buildEphemeralMessage(content));
    }

    if (invocation.subcommandName === "add") {
      const parsedDuration = parseTimedRoleDuration(invocation.duration);
      if (!parsedDuration) {
        return Response.json(
          buildEphemeralMessage("Invalid duration. Use values like 1h, 1w, or 1m.")
        );
      }

      let storeResponse: Response;
      try {
        storeResponse = await storeStub.fetch("https://moderation-store/timed-role", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            guildId: interaction.guild_id,
            userId: invocation.userId,
            roleId: invocation.roleId,
            durationInput: parsedDuration.durationInput,
            expiresAtMs: parsedDuration.expiresAtMs,
          }),
        });
      } catch (error) {
        console.error("Timed role save failed", error);
        return Response.json(buildEphemeralMessage("Failed to save the timed role."));
      }

      if (!storeResponse.ok) {
        console.error("Timed role save failed", await storeResponse.text());
        return Response.json(buildEphemeralMessage("Failed to save the timed role."));
      }

      try {
        await addGuildMemberRole(
          interaction.guild_id,
          invocation.userId,
          invocation.roleId,
          env.DISCORD_BOT_TOKEN
        );
      } catch (error) {
        console.error("Timed role assignment failed", error);
        try {
          const rollbackResponse = await storeStub.fetch(
            "https://moderation-store/timed-role/remove",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                guildId: interaction.guild_id,
                userId: invocation.userId,
                roleId: invocation.roleId,
              }),
            }
          );

          if (!rollbackResponse.ok) {
            console.error("Timed role rollback failed", await rollbackResponse.text());
            return Response.json(
              buildEphemeralMessage(
                "Failed to assign the timed role, and rollback failed."
              )
            );
          }
        } catch (rollbackError) {
          console.error("Timed role rollback failed", rollbackError);
          return Response.json(
            buildEphemeralMessage(
              "Failed to assign the timed role, and rollback failed."
            )
          );
        }

        return Response.json(buildEphemeralMessage("Failed to assign the timed role."));
      }

      return Response.json(
        buildEphemeralMessage(
          `Assigned <@&${invocation.roleId}> to <@${invocation.userId}> for ${invocation.duration} (${formatTimedRoleExpiry(parsedDuration.expiresAtMs)}).`
        )
      );
    }

    if (invocation.subcommandName === "remove") {
      let assignmentsResponse: Response;
      try {
        assignmentsResponse = await storeStub.fetch(
          `https://moderation-store/timed-roles?guildId=${encodeURIComponent(interaction.guild_id)}`
        );
      } catch (error) {
        console.error("Failed to load timed roles", error);
        return Response.json(buildEphemeralMessage("Failed to load timed roles."));
      }

      if (!assignmentsResponse.ok) {
        console.error("Timed role list failed", await assignmentsResponse.text());
        return Response.json(buildEphemeralMessage("Failed to load timed roles."));
      }

      const assignments = (await assignmentsResponse.json()) as Array<{
        userId: string;
        roleId: string;
      }>;
      const activeAssignment = assignments.find(
        (entry) =>
          entry.userId === invocation.userId && entry.roleId === invocation.roleId
      );
      if (!activeAssignment) {
        return Response.json(
          buildEphemeralMessage(
            `<@&${invocation.roleId}> is not currently active for <@${invocation.userId}>.`
          )
        );
      }

      try {
        await removeGuildMemberRole(
          interaction.guild_id,
          invocation.userId,
          invocation.roleId,
          env.DISCORD_BOT_TOKEN
        );
      } catch (error) {
        console.error("Timed role removal failed", error);
        return Response.json(buildEphemeralMessage("Failed to remove the timed role."));
      }

      let deleteResponse: Response;
      try {
        deleteResponse = await storeStub.fetch(
          "https://moderation-store/timed-role/remove",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guildId: interaction.guild_id,
              userId: invocation.userId,
              roleId: invocation.roleId,
            }),
          }
        );
      } catch (error) {
        console.error("Timed role clear failed", error);
        return Response.json(buildEphemeralMessage("Failed to clear the timed role."));
      }

      if (!deleteResponse.ok) {
        console.error("Timed role clear failed", await deleteResponse.text());
        return Response.json(buildEphemeralMessage("Failed to clear the timed role."));
      }

      return Response.json(
        buildEphemeralMessage(
          `Removed <@&${invocation.roleId}> from <@${invocation.userId}>.`
        )
      );
    }
  }

  if (invocation.subcommandName === "list") {
    try {
      const config = await getBlocklistFromStore(() =>
        storeStub.fetch("https://moderation-store/config")
      );
      const guildConfig = config.guilds?.[interaction.guild_id];
      const effectiveEmojis = Array.from(
        new Set([
          ...config.emojis,
          ...(guildConfig?.enabled === false ? [] : guildConfig?.emojis ?? []),
        ])
      );
      const content = formatBoundedBulletList(
        "Blocked emojis in this server:",
        "No emojis are blocked in this server.",
        effectiveEmojis
      );

      return Response.json(buildEphemeralMessage(content));
    } catch (error) {
      console.error("Failed to load moderation config", error);
      return Response.json(
        buildEphemeralMessage("Failed to load the server blocklist.")
      );
    }
  }

  const blocklistInvocation = invocation as Extract<
    CommandInvocation,
    { commandName: "blocklist"; subcommandName: "add" | "remove" }
  >;
  const normalizedEmoji = normalizeEmoji(blocklistInvocation.emoji);
  if (!normalizedEmoji) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

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

  if (blocklistInvocation.subcommandName === "add" && isAlreadyBlocked) {
    return Response.json(
      buildEphemeralMessage(`${blocklistInvocation.emoji} is already blocked in this server.`)
    );
  }

  if (blocklistInvocation.subcommandName === "remove" && !isAlreadyBlocked) {
    return Response.json(
      buildEphemeralMessage(`${blocklistInvocation.emoji} is not currently blocked in this server.`)
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
          action: blocklistInvocation.subcommandName,
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
    blocklistInvocation.subcommandName === "add"
      ? `Blocked ${blocklistInvocation.emoji} in this server.`
      : `Unblocked ${blocklistInvocation.emoji} in this server.`;

  return Response.json(buildEphemeralMessage(actionMessage));
}

function formatBoundedBulletList(
  title: string,
  emptyMessage: string,
  items: string[]
): string {
  if (items.length === 0) {
    return emptyMessage;
  }

  const lines = [title];

  for (let index = 0; index < items.length; index += 1) {
    const line = `- ${items[index]}`;
    const remainingAfterLine = items.length - index - 1;

    if (remainingAfterLine === 0) {
      return [...lines, line].join("\n");
    }

    const contentWithLine = [...lines, line].join("\n");
    const summaryLine = `...and ${remainingAfterLine} more.`;

    if (`${contentWithLine}\n${summaryLine}`.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      lines.push(line);
      continue;
    }

    let omittedCount = items.length - index;
    while (lines.length > 1) {
      const truncatedContent = [...lines, `...and ${omittedCount} more.`].join("\n");
      if (truncatedContent.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
        return truncatedContent;
      }

      lines.pop();
      omittedCount += 1;
    }

    return `${title}\n...and ${items.length} more.`;
  }

  return lines.join("\n");
}
