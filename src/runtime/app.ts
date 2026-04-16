import { ADMIN_ASSETS, ADMIN_LOGIN_HTML } from "./admin-bundle";
import {
  createAdminSessionCookie,
  hasValidAdminSession,
  isValidAdminPassword,
} from "./admin-auth";
import { normalizeEmoji } from "../blocklist";
import {
  addGuildMemberRole,
  DiscordApiError,
  removeGuildMemberRole,
  syncApplicationCommands,
  verifyDiscordSignature,
} from "../discord";
import {
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "../discord-interactions";
import { formatTimedRoleExpiry, parseTimedRoleDuration } from "../timed-roles";
import type { GatewayController, RuntimeStore } from "./contracts";

const DISCORD_INTERACTION_MAX_AGE_SECONDS = 5 * 60;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2_000;

interface DiscordInteraction {
  type: number;
  guild_id?: string;
  member?: {
    permissions?: string;
  };
  data?: unknown;
}

interface RuntimeAppOptions {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminSessionSecret?: string;
  adminUiPassword?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  store: RuntimeStore;
  gateway: GatewayController;
}

export function createRuntimeApp(options: RuntimeAppOptions) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/health") {
        return new Response("OK", { status: 200 });
      }

      if (request.method === "GET" && url.pathname === "/admin/login") {
        if (options.adminUiPassword && (await isAdminUiAuthorized(request, options))) {
          return redirect("/admin");
        }
        return renderAdminShell();
      }

      if (request.method === "POST" && url.pathname === "/admin/login") {
        return handleAdminLogin(request, options);
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        if (!(await isAdminUiAuthorized(request, options))) {
          return redirect("/admin/login");
        }
        return renderAdminShell();
      }

      if (request.method === "GET" && url.pathname.startsWith("/admin/assets/")) {
        const filename = url.pathname.slice("/admin/assets/".length);
        const asset = ADMIN_ASSETS[filename];
        if (!asset) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(asset.content, {
          status: 200,
          headers: { "content-type": asset.contentType },
        });
      }

      if (request.method === "GET" && url.pathname === "/admin/gateway/status") {
        if (!(await isAuthorized(request, options))) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json(await options.gateway.status());
      }

      if (request.method === "POST" && url.pathname === "/admin/gateway/start") {
        if (!(await isAuthorized(request, options))) {
          return new Response("Unauthorized", { status: 401 });
        }
        return Response.json(await bootstrap());
      }

      if (request.method === "POST" && url.pathname === "/interactions") {
        return handleInteractionRequest(request, options);
      }

      return new Response("Not found", { status: 404 });
    },
    bootstrap,
  };

  async function bootstrap() {
    if (options.discordApplicationId) {
      try {
        await syncApplicationCommands(options.discordApplicationId, options.discordBotToken);
      } catch (error) {
        console.error("Failed to sync slash commands during bootstrap", error);
      }
    }
    return options.gateway.start();
  }
}

function renderAdminShell(): Response {
  return new Response(ADMIN_LOGIN_HTML, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

async function handleAdminLogin(
  request: Request,
  options: RuntimeAppOptions
): Promise<Response> {
  if (!options.adminUiPassword || !options.adminSessionSecret) {
    return new Response("Admin login is not configured.", { status: 404 });
  }

  const formData = await request.formData();
  if (!(await isValidAdminPassword(formData.get("password"), options.adminUiPassword))) {
    return new Response("Unauthorized", { status: 401 });
  }

  return redirect("/admin", {
    "set-cookie": await createAdminSessionCookie(
      options.adminSessionSecret,
      { secure: new URL(request.url).protocol === "https:" }
    ),
  });
}

async function handleInteractionRequest(
  request: Request,
  options: RuntimeAppOptions
): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response("Unauthorized", { status: 401 });
  }

  const verifyDiscordRequest =
    options.verifyDiscordRequest ??
    ((ts: string, rawBody: string, sig: string) =>
      verifyDiscordSignature(options.discordPublicKey, ts, rawBody, sig));

  if (!(await verifyDiscordRequest(timestamp, body, signature))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isFreshDiscordTimestamp(timestamp)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;
  if (interaction?.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction?.type === 2) {
    return handleApplicationCommand(interaction, options.store, options.discordBotToken);
  }

  return Response.json(buildEphemeralMessage("Unsupported interaction type."));
}

async function handleApplicationCommand(
  interaction: DiscordInteraction,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  if (typeof interaction?.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This command can only be used inside a server."));
  }
  if (!hasGuildAdminPermission(interaction?.member?.permissions ?? "")) {
    return Response.json(
      buildEphemeralMessage("You need Administrator or Manage Guild permissions to use this command.")
    );
  }

  const invocation = extractCommandInvocation(interaction);
  if (!invocation) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "list") {
    try {
      const config = await store.readConfig();
      const guildConfig = config.guilds?.[interaction.guild_id];
      const effectiveEmojis = guildConfig?.enabled === false ? [] : guildConfig?.emojis ?? [];
      const content = formatBoundedBulletList(
        "Blocked emojis in this server:",
        "No emojis are blocked in this server.",
        effectiveEmojis
      );
      return Response.json(buildEphemeralMessage(content));
    } catch (error) {
      console.error("Failed to load moderation config", error);
      return Response.json(buildEphemeralMessage("Failed to load the server blocklist."));
    }
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "list") {
    const assignments = await store.listTimedRolesByGuild(interaction.guild_id);
    const content =
      assignments.length === 0
        ? "No timed roles are active in this server."
        : `Active timed roles:\n${assignments
            .map(
              (assignment) =>
                `- <@${assignment.userId}> -> <@&${assignment.roleId}> (${assignment.durationInput}, expires ${formatTimedRoleExpiry(assignment.expiresAtMs)})`
            )
            .join("\n")}`;
    return Response.json(buildEphemeralMessage(content));
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "add") {
    const parsedDuration = parseTimedRoleDuration(invocation.duration, Date.now());
    if (!parsedDuration) {
      return Response.json(buildEphemeralMessage("Invalid duration. Use values like 1h, 1w, or 1m."));
    }
    await store.upsertTimedRole({
      guildId: interaction.guild_id,
      userId: invocation.userId,
      roleId: invocation.roleId,
      durationInput: parsedDuration.durationInput,
      expiresAtMs: parsedDuration.expiresAtMs,
    });

    try {
      await addGuildMemberRole(
        interaction.guild_id,
        invocation.userId,
        invocation.roleId,
        discordBotToken
      );
    } catch (error) {
      console.error("Timed role assignment failed", error);
      try {
        await store.deleteTimedRole({
          guildId: interaction.guild_id,
          userId: invocation.userId,
          roleId: invocation.roleId,
        });
      } catch (rollbackError) {
        console.error("Timed role rollback failed", rollbackError);
        return Response.json(
          buildEphemeralMessage("Failed to assign the timed role, and rollback failed.")
        );
      }

      return Response.json(
        buildEphemeralMessage(describeTimedRoleAssignmentFailure(error))
      );
    }

    return Response.json(
      buildEphemeralMessage(
        `Assigned <@&${invocation.roleId}> to <@${invocation.userId}> for ${invocation.duration} (${formatTimedRoleExpiry(parsedDuration.expiresAtMs)}).`
      )
    );
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "remove") {
    const assignments = await store.listTimedRolesByGuild(interaction.guild_id);
    const activeAssignment = assignments.find(
      (entry) => entry.userId === invocation.userId && entry.roleId === invocation.roleId
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
        discordBotToken
      );
    } catch (error) {
      console.error("Timed role removal failed", error);
      return Response.json(buildEphemeralMessage("Failed to remove the timed role."));
    }

    await store.deleteTimedRole({
      guildId: interaction.guild_id,
      userId: invocation.userId,
      roleId: invocation.roleId,
    });
    return Response.json(
      buildEphemeralMessage(`Removed <@&${invocation.roleId}> from <@${invocation.userId}>.`)
    );
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "add") {
    const normalizedEmoji = normalizeEmoji(invocation.emoji);
    if (!normalizedEmoji) {
      return Response.json(buildEphemeralMessage("Invalid emoji."));
    }
    let isAlreadyBlocked = false;
    try {
      const config = await store.readConfig();
      isAlreadyBlocked =
        config.guilds?.[interaction.guild_id]?.emojis.includes(normalizedEmoji) ?? false;
    } catch (error) {
      console.error("Failed to load moderation config", error);
      return Response.json(buildEphemeralMessage("Failed to update the server blocklist."));
    }
    if (isAlreadyBlocked) {
      return Response.json(
        buildEphemeralMessage(`${invocation.emoji} is already blocked in this server.`)
      );
    }
    await store.applyGuildEmojiMutation({
      guildId: interaction.guild_id,
      emoji: normalizedEmoji,
      action: "add",
    });
    return Response.json(
      buildEphemeralMessage(`Blocked ${invocation.emoji} in this server.`)
    );
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "remove") {
    const normalizedEmoji = normalizeEmoji(invocation.emoji);
    if (!normalizedEmoji) {
      return Response.json(buildEphemeralMessage("Invalid emoji."));
    }
    let isBlocked = false;
    try {
      const config = await store.readConfig();
      isBlocked =
        config.guilds?.[interaction.guild_id]?.emojis.includes(normalizedEmoji) ?? false;
    } catch (error) {
      console.error("Failed to load moderation config", error);
      return Response.json(buildEphemeralMessage("Failed to update the server blocklist."));
    }
    if (!isBlocked) {
      return Response.json(
        buildEphemeralMessage(
          `${invocation.emoji} is not currently blocked in this server.`
        )
      );
    }
    await store.applyGuildEmojiMutation({
      guildId: interaction.guild_id,
      emoji: normalizedEmoji,
      action: "remove",
    });
    return Response.json(
      buildEphemeralMessage(`Unblocked ${invocation.emoji} in this server.`)
    );
  }

  return Response.json(buildEphemeralMessage("Unsupported command."));
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

async function isAuthorized(
  request: Request,
  options: Pick<RuntimeAppOptions, "adminAuthSecret" | "adminSessionSecret" | "adminUiPassword">
): Promise<boolean> {
  if (isBearerAuthorized(request, options.adminAuthSecret)) {
    return true;
  }

  if (options.adminUiPassword && options.adminSessionSecret) {
    return hasValidAdminSession(request, options.adminSessionSecret);
  }

  return !options.adminAuthSecret && !options.adminUiPassword;
}

function isBearerAuthorized(request: Request, secret?: string): boolean {
  return !!secret && request.headers.get("Authorization") === `Bearer ${secret}`;
}

async function isAdminUiAuthorized(
  request: Request,
  options: Pick<RuntimeAppOptions, "adminSessionSecret" | "adminUiPassword">
): Promise<boolean> {
  if (!options.adminUiPassword) {
    return true;
  }

  if (!options.adminSessionSecret) {
    return false;
  }

  return hasValidAdminSession(request, options.adminSessionSecret);
}

function redirect(location: string, headersInit?: HeadersInit): Response {
  const headers = new Headers(headersInit);
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

function describeTimedRoleAssignmentFailure(error: unknown): string {
  if (!(error instanceof DiscordApiError)) {
    return "Failed to assign the timed role.";
  }

  if (error.status === 403) {
    return "Failed to assign the timed role. Ensure the bot has Manage Roles and that its highest role is above the target role.";
  }

  if (error.status === 404) {
    return "Failed to assign the timed role. The member or role could not be found in this server.";
  }

  if (error.status >= 500) {
    return "Failed to assign the timed role because Discord is currently unavailable.";
  }

  return `Failed to assign the timed role (${error.status}).`;
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
