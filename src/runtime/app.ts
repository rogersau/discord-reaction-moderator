import { ADMIN_ASSETS, ADMIN_LOGIN_HTML } from "./admin-bundle";
import type { AppConfigMutation } from "./admin-types";
import {
  ADMIN_SESSION_COOKIE_NAME,
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

class AdminApiInputError extends Error {}

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

      if (request.method === "POST" && url.pathname === "/admin/logout") {
        return new Response(null, {
          status: 302,
          headers: {
            location: "/admin/login",
            "set-cookie": `${ADMIN_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/admin") {
        if (!(await isAdminUiAuthorized(request, options))) {
          return redirect("/admin/login");
        }
        return renderAdminShell(true);
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

      if (url.pathname.startsWith("/admin/api/")) {
        const sessionUnauthorized = await requireAdminSession(request, options);
        if (sessionUnauthorized) return sessionUnauthorized;

        if (request.method === "GET" && url.pathname === "/admin/api/gateway/status") {
          return Response.json(await options.gateway.status());
        }

        if (request.method === "POST" && url.pathname === "/admin/api/gateway/start") {
          return Response.json(await bootstrap());
        }

        if (request.method === "GET" && url.pathname === "/admin/api/config") {
          const config = await options.store.readConfig();
          return Response.json({ botUserId: config.botUserId });
        }

        if (request.method === "POST" && url.pathname === "/admin/api/config") {
          const parsedBody = await parseJsonBody(request, parseAppConfigMutation);
          if (!parsedBody.ok) {
            return parsedBody.response;
          }

          await options.store.upsertAppConfig(parsedBody.value);
          return Response.json({ ok: true });
        }

        if (request.method === "GET" && url.pathname === "/admin/api/blocklist") {
          const guildId = url.searchParams.get("guildId");
          if (!guildId) {
            return Response.json({ error: "guildId is required" }, { status: 400 });
          }
          const config = await options.store.readConfig();
          const guild = config.guilds?.[guildId];
          return Response.json({ guildId, enabled: guild?.enabled ?? true, emojis: guild?.emojis ?? [] });
        }

        if (request.method === "POST" && url.pathname === "/admin/api/blocklist") {
          const parsedBody = await parseJsonBody(request, parseGuildEmojiMutation);
          if (!parsedBody.ok) {
            return parsedBody.response;
          }

          const config = await options.store.applyGuildEmojiMutation(parsedBody.value);
          return Response.json(config);
        }

        return Response.json({ error: "Not found" }, { status: 404 });
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

function renderAdminShell(authenticated = false): Response {
  const html = authenticated
    ? ADMIN_LOGIN_HTML.replace('<div id="admin-root"></div>', '<div id="admin-root" data-authenticated="true"></div>')
    : ADMIN_LOGIN_HTML;
  return new Response(html, {
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
  if (await isBearerAuthorized(request, options.adminAuthSecret)) {
    return true;
  }

  if (options.adminUiPassword && options.adminSessionSecret) {
    return hasValidAdminSession(request, options.adminSessionSecret);
  }

  return !options.adminAuthSecret && !options.adminUiPassword;
}

async function isBearerAuthorized(request: Request, secret?: string): Promise<boolean> {
  if (!secret) {
    return false;
  }

  const authorization = request.headers.get("Authorization");
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer ")) {
    return false;
  }

  return isValidAdminPassword(authorization.slice("Bearer ".length), secret);
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

async function requireAdminSession(
  request: Request,
  options: Pick<RuntimeAppOptions, "adminSessionSecret" | "adminUiPassword">
): Promise<Response | null> {
  if (!options.adminUiPassword || !options.adminSessionSecret) {
    return Response.json({ error: "Admin API is not configured." }, { status: 404 });
  }

  const authorized = await hasValidAdminSession(request, options.adminSessionSecret);
  if (!authorized) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function redirect(location: string, headersInit?: HeadersInit): Response {
  const headers = new Headers(headersInit);
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}

async function parseJsonBody<T>(
  request: Request,
  parse: (body: unknown) => T
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: parse(await request.json()) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof AdminApiInputError) {
      return {
        ok: false,
        response: Response.json(
          { error: error.message || "Invalid JSON body" },
          { status: 400 }
        ),
      };
    }

    throw error;
  }
}

function parseAppConfigMutation(body: unknown): AppConfigMutation {
  if (
    !isRecord(body) ||
    typeof body.key !== "string" ||
    body.key.length === 0 ||
    typeof body.value !== "string"
  ) {
    throw new AdminApiInputError("Missing app config key or value");
  }

  return {
    key: body.key,
    value: body.value,
  };
}

function parseGuildEmojiMutation(
  body: unknown
): { guildId: string; emoji: string; action: "add" | "remove" } {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const guildId = body.guildId;
  const emoji = normalizeEmoji(asOptionalString(body.emoji));
  const action = body.action;

  if (typeof guildId !== "string" || guildId.length === 0 || !emoji || typeof action !== "string") {
    throw new AdminApiInputError("Missing guildId, emoji or action");
  }

  if (action !== "add" && action !== "remove") {
    throw new AdminApiInputError("Invalid action. Use 'add' or 'remove'");
  }

  return {
    guildId,
    emoji,
    action,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
