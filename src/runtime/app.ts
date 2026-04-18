import { ADMIN_ASSETS, ADMIN_LOGIN_HTML } from "./admin-bundle";
import type {
  AdminGuildDirectoryEntry,
  AdminGuildDirectoryResponse,
  AppConfigMutation,
} from "./admin-types";
import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionCookie,
  hasValidAdminSession,
  isValidAdminPassword,
} from "./admin-auth";
import { normalizeEmoji } from "../blocklist";
import {
  addGuildMemberRole,
  createTicketChannel,
  deleteChannel,
  DiscordApiError,
  listBotGuilds,
  type GuildTicketResources,
  listChannelMessages,
  listGuildTicketResources,
  removeGuildMemberRole,
  syncApplicationCommands,
  uploadTranscriptToChannel,
  verifyDiscordSignature,
} from "../discord";
import {
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "../discord-interactions";
import {
  buildTicketChannelName,
  buildTicketCloseCustomId,
  buildTicketModalResponse,
  buildTicketOpenCustomId,
  extractTicketAnswersFromModal,
  parseTicketCustomId,
  renderTicketTranscript,
} from "../tickets";
import { formatTimedRoleExpiry, parseTimedRoleDuration } from "../timed-roles";
import type { GatewayController, RuntimeStore } from "./contracts";
import type {
  BlocklistConfig,
  TicketInstance,
  TicketPanelConfig,
  TicketQuestion,
  TicketTypeConfig,
  TimedRoleAssignment,
} from "../types";

const DISCORD_INTERACTION_MAX_AGE_SECONDS = 5 * 60;
const DISCORD_MESSAGE_CONTENT_LIMIT = 2_000;
const DISCORD_API_BASE = "https://discord.com/api/v10";

interface DiscordInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    permissions?: string;
    roles?: unknown;
    user?: {
      id?: string;
    };
  };
  user?: {
    id?: string;
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

interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
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

        if (request.method === "GET" && url.pathname === "/admin/api/overview") {
          const [gateway, config, timedRoles] = await Promise.all([
            options.gateway.status(),
            options.store.readConfig(),
            options.store.listTimedRoles(),
          ]);

          return Response.json({
            gateway,
            guilds: buildAdminOverviewGuilds(config, timedRoles),
          });
        }

        if (request.method === "GET" && url.pathname === "/admin/api/guilds") {
          const guilds = buildAdminGuildDirectory(await listBotGuilds(options.discordBotToken));
          const body: AdminGuildDirectoryResponse = { guilds };
          return Response.json(body);
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

        if (request.method === "GET" && url.pathname === "/admin/api/tickets/panel") {
          const guildId = url.searchParams.get("guildId");
          if (!guildId) {
            return Response.json({ error: "guildId is required" }, { status: 400 });
          }

          return Response.json({
            panel: await options.store.readTicketPanelConfig(guildId),
          });
        }

        if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel") {
          const parsedBody = await parseJsonBody(request, parseTicketPanelConfig);
          if (!parsedBody.ok) {
            return parsedBody.response;
          }

          await options.store.upsertTicketPanelConfig(parsedBody.value);
          return Response.json({ ok: true, panel: parsedBody.value });
        }

        if (request.method === "GET" && url.pathname === "/admin/api/tickets/resources") {
          const guildId = url.searchParams.get("guildId");
          if (!guildId) {
            return Response.json({ error: "guildId is required" }, { status: 400 });
          }

          const resources = await listGuildTicketResources(guildId, options.discordBotToken);
          return Response.json({
            guildId,
            roles: resources.roles.map(({ id, name }) => ({ id, name })),
            categories: resources.channels
              .filter((channel) => channel.type === 4)
              .map(({ id, name }) => ({ id, name })),
            textChannels: resources.channels
              .filter((channel) => channel.type === 0)
              .map(({ id, name }) => ({ id, name })),
          });
        }

        if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel/publish") {
          const parsedBody = await parseJsonBody(request, parseTicketPanelPublishMutation);
          if (!parsedBody.ok) {
            return parsedBody.response;
          }

          const panel = await options.store.readTicketPanelConfig(parsedBody.value.guildId);
          if (!panel) {
            return Response.json({ error: "Ticket panel config not found." }, { status: 404 });
          }

          const resources = await listGuildTicketResources(parsedBody.value.guildId, options.discordBotToken);
          const missingTargets = getMissingTicketPanelTargets(panel, resources);
          if (missingTargets.length > 0) {
            return Response.json(
              {
                error: `Ticket panel config references missing Discord targets: ${missingTargets.join(", ")}`,
              },
              { status: 400 }
            );
          }

          let panelMessageId: string;
          try {
            panelMessageId = await publishTicketPanel(panel, options.discordBotToken);
          } catch (error) {
            return Response.json(
              {
                error:
                  error instanceof DiscordApiError
                    ? error.message
                    : "Failed to publish the ticket panel to Discord.",
              },
              { status: 502 }
            );
          }
          await options.store.upsertTicketPanelConfig({
            ...panel,
            panelMessageId,
          });
          return Response.json({ ok: true, panelMessageId });
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

        if (request.method === "GET" && url.pathname === "/admin/api/timed-roles") {
          const guildId = url.searchParams.get("guildId");
          if (!guildId) {
            return Response.json({ error: "guildId is required" }, { status: 400 });
          }

          return Response.json({
            guildId,
            assignments: await options.store.listTimedRolesByGuild(guildId),
          });
        }

        if (request.method === "POST" && url.pathname === "/admin/api/timed-roles") {
          const parsedBody = await parseJsonBody(request, parseTimedRoleAdminMutation);
          if (!parsedBody.ok) {
            return parsedBody.response;
          }

          if (parsedBody.value.action === "add") {
            const parsedDuration = parseTimedRoleDuration(parsedBody.value.duration, Date.now());
            if (!parsedDuration) {
              return Response.json(
                { error: "Invalid duration. Use values like 1h, 1w, or 1m." },
                { status: 400 }
              );
            }

            await options.store.upsertTimedRole({
              guildId: parsedBody.value.guildId,
              userId: parsedBody.value.userId,
              roleId: parsedBody.value.roleId,
              durationInput: parsedDuration.durationInput,
              expiresAtMs: parsedDuration.expiresAtMs,
            });

            try {
              await addGuildMemberRole(
                parsedBody.value.guildId,
                parsedBody.value.userId,
                parsedBody.value.roleId,
                options.discordBotToken
              );
            } catch (error) {
              await options.store.deleteTimedRole({
                guildId: parsedBody.value.guildId,
                userId: parsedBody.value.userId,
                roleId: parsedBody.value.roleId,
              });
              return Response.json(
                { error: describeTimedRoleAssignmentFailure(error) },
                { status: 502 }
              );
            }
          } else {
            try {
              await removeGuildMemberRole(
                parsedBody.value.guildId,
                parsedBody.value.userId,
                parsedBody.value.roleId,
                options.discordBotToken
              );
            } catch (error) {
              return Response.json(
                { error: describeTimedRoleRemovalFailure(error) },
                { status: 502 }
              );
            }

            await options.store.deleteTimedRole({
              guildId: parsedBody.value.guildId,
              userId: parsedBody.value.userId,
              roleId: parsedBody.value.roleId,
            });
          }

          return Response.json({
            guildId: parsedBody.value.guildId,
            assignments: await options.store.listTimedRolesByGuild(parsedBody.value.guildId),
          });
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

function buildAdminOverviewGuilds(
  config: BlocklistConfig,
  timedRoles: TimedRoleAssignment[]
): AdminOverviewGuild[] {
  const guilds = new Map<string, AdminOverviewGuild>();

  for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
    guilds.set(guildId, {
      guildId,
      emojis: [...guildConfig.emojis],
      timedRoles: [],
    });
  }

  for (const timedRole of timedRoles) {
    const existing = guilds.get(timedRole.guildId);
    if (existing) {
      existing.timedRoles.push(timedRole);
      continue;
    }

    guilds.set(timedRole.guildId, {
      guildId: timedRole.guildId,
      emojis: [],
      timedRoles: [timedRole],
    });
  }

  return [...guilds.values()].sort((left, right) => left.guildId.localeCompare(right.guildId));
}

function buildAdminGuildDirectory(
  guilds: Array<{ guildId: string; name: string }>
): AdminGuildDirectoryEntry[] {
  const nameCounts = new Map<string, number>();

  for (const guild of guilds) {
    nameCounts.set(guild.name, (nameCounts.get(guild.name) ?? 0) + 1);
  }

  return [...guilds]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.guildId.localeCompare(right.guildId)
    )
    .map((guild) => ({
      guildId: guild.guildId,
      name: guild.name,
      label:
        (nameCounts.get(guild.name) ?? 0) > 1
          ? `${guild.name} (${guild.guildId})`
          : guild.name,
    }));
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

  if (interaction?.type === 3) {
    return handleMessageComponentInteraction(interaction, options.store, options.discordBotToken);
  }

  if (interaction?.type === 5) {
    return handleTicketModalSubmitInteraction(interaction, options.store, options.discordBotToken);
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

async function handleMessageComponentInteraction(
  interaction: DiscordInteraction,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This interaction can only be used inside a server."));
  }

  const customId = getInteractionCustomId(interaction);
  if (!customId) {
    return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }

  const parsedCustomId = parseTicketCustomId(customId);
  if (!parsedCustomId) {
    return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }

  if (parsedCustomId.action === "open") {
    const panel = await store.readTicketPanelConfig(interaction.guild_id);
    const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsedCustomId.ticketTypeId);
    if (!panel || !ticketType) {
      return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
    }

    return Response.json(buildTicketModalResponse(ticketType));
  }

  return handleTicketCloseInteraction(
    interaction,
    interaction.guild_id,
    parsedCustomId.channelId,
    store,
    discordBotToken
  );
}

async function handleTicketModalSubmitInteraction(
  interaction: DiscordInteraction,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This interaction can only be used inside a server."));
  }

  const openerUserId = getInteractionUserId(interaction);
  if (!openerUserId) {
    return Response.json(buildEphemeralMessage("Could not determine which user opened this ticket."));
  }

  const parsedCustomId = parseTicketCustomId(getInteractionCustomId(interaction) ?? "");
  if (!parsedCustomId || parsedCustomId.action !== "open") {
    return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
  }

  const [config, panel] = await Promise.all([
    store.readConfig(),
    store.readTicketPanelConfig(interaction.guild_id),
  ]);
  const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsedCustomId.ticketTypeId);
  if (!panel || !ticketType) {
    return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
  }

  let channel: Awaited<ReturnType<typeof createTicketChannel>>;
  try {
    channel = await createTicketChannel(
      {
        guildId: interaction.guild_id,
        name: buildTicketChannelName(ticketType.channelNamePrefix, openerUserId),
        parentId: panel.categoryChannelId,
        botUserId: config.botUserId,
        openerUserId,
        supportRoleId: ticketType.supportRoleId,
      },
      discordBotToken
    );
  } catch (error) {
    console.error("Failed to create ticket channel", error);
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }

  const instance: TicketInstance = {
    guildId: interaction.guild_id,
    channelId: channel.id,
    ticketTypeId: ticketType.id,
    ticketTypeLabel: ticketType.label,
    openerUserId,
    supportRoleId: ticketType.supportRoleId,
    status: "open",
    answers: extractTicketAnswersFromModal(interaction as Parameters<typeof extractTicketAnswersFromModal>[0], ticketType.questions),
    openedAtMs: Date.now(),
    closedAtMs: null,
    closedByUserId: null,
    transcriptMessageId: null,
  };

  let persisted = false;
  try {
    await store.createTicketInstance(instance);
    persisted = true;
    await createDiscordChannelMessage(
      channel.id,
      buildTicketOpeningMessage(instance),
      discordBotToken
    );
  } catch (error) {
    console.error("Failed to finish ticket creation", error);
    if (persisted) {
      try {
        await store.deleteTicketInstance({
          guildId: interaction.guild_id,
          channelId: channel.id,
        });
      } catch (rollbackError) {
        console.error("Failed to roll back ticket instance", rollbackError);
      }
    }
    try {
      await deleteChannel(channel.id, discordBotToken);
    } catch (deleteError) {
      console.error("Failed to delete ticket channel after open failure", deleteError);
    }
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }

  return Response.json(buildEphemeralMessage(`Created your ticket: <#${channel.id}>`));
}

async function handleTicketCloseInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is closing this ticket."));
  }

  const channelId =
    typeof interaction.channel_id === "string" && interaction.channel_id.length > 0
      ? interaction.channel_id
      : requestedChannelId;
  if (channelId !== requestedChannelId) {
    return Response.json(buildEphemeralMessage("That ticket close button is no longer valid."));
  }

  const ticket = await store.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  const memberRoleIds = getInteractionMemberRoles(interaction);
  const canClose =
    ticket.openerUserId === userId ||
    (ticket.supportRoleId !== null && memberRoleIds.includes(ticket.supportRoleId));
  if (!canClose) {
    return Response.json(
      buildEphemeralMessage("Only the ticket opener or the configured support role can close this ticket.")
    );
  }

  const panel = await store.readTicketPanelConfig(guildId);
  if (!panel) {
    return Response.json(buildEphemeralMessage("This ticket panel configuration is missing."));
  }

  const closedAtMs = Date.now();
  const closingTicket: TicketInstance = {
    ...ticket,
    status: "closed",
    closedAtMs,
    closedByUserId: userId,
  };
  let transcriptMessageId: string;
  try {
    const messages = await listAllChannelMessages(channelId, discordBotToken);
    const transcript = renderTicketTranscript(
      closingTicket,
      messages.map((message) => ({
        authorId: message.author.id,
        authorTag: message.author.global_name ?? message.author.username,
        content: message.content,
        createdAtMs: Date.parse(message.timestamp),
      }))
    );
    const transcriptMessage = await uploadTranscriptToChannel(
      panel.transcriptChannelId,
      `ticket-${channelId}.txt`,
      transcript,
      discordBotToken
    );
    transcriptMessageId = transcriptMessage.id;
  } catch (error) {
    console.error("Failed to upload transcript", error);
    try {
      await createDiscordChannelMessage(
        channelId,
        {
          content:
            "Failed to upload the transcript for this ticket. The ticket will remain open so support staff can retry closing it.",
        },
        discordBotToken
      );
    } catch (warningError) {
      console.error("Failed to post transcript warning", warningError);
    }
    return Response.json(
      buildEphemeralMessage(
        "Failed to upload the transcript. The ticket is still open, and a warning was posted in the channel."
      )
    );
  }

  try {
    await store.closeTicketInstance({
      guildId,
      channelId,
      closedByUserId: userId,
      closedAtMs,
      transcriptMessageId,
    });
  } catch (error) {
    console.error("Failed to close ticket", error);
    return Response.json(buildEphemeralMessage("Failed to close the ticket."));
  }

  try {
    await deleteChannel(channelId, discordBotToken);
  } catch (error) {
    console.error("Failed to delete closed ticket channel", error);
    return Response.json(
      buildEphemeralMessage(
        "Closed ticket and uploaded the transcript, but failed to delete the channel. Please clean it up manually."
      )
    );
  }

  return Response.json(buildEphemeralMessage("Closed ticket and uploaded the transcript."));
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

function parseTicketPanelPublishMutation(body: unknown): { guildId: string } {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
  };
}

function parseTicketPanelConfig(body: unknown): TicketPanelConfig {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    panelChannelId: asRequiredString(body.panelChannelId, "panelChannelId"),
    categoryChannelId: asRequiredString(body.categoryChannelId, "categoryChannelId"),
    transcriptChannelId: asRequiredString(body.transcriptChannelId, "transcriptChannelId"),
    panelTitle: asOptionalNullableString(body.panelTitle, "panelTitle"),
    panelDescription: asOptionalNullableString(body.panelDescription, "panelDescription"),
    panelFooter: asOptionalNullableString(body.panelFooter, "panelFooter"),
    panelMessageId: asNullableString(body.panelMessageId, "panelMessageId"),
    ticketTypes: parseTicketTypes(body.ticketTypes),
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

function parseTimedRoleAdminMutation(
  body: unknown
):
  | { action: "add"; guildId: string; userId: string; roleId: string; duration: string }
  | { action: "remove"; guildId: string; userId: string; roleId: string } {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const guildId = asOptionalString(body.guildId);
  const userId = asOptionalString(body.userId);
  const roleId = asOptionalString(body.roleId);
  const action = body.action;

  if (!guildId || !userId || !roleId || typeof action !== "string") {
    throw new AdminApiInputError("Missing guildId, userId, roleId or action");
  }

  if (action === "add") {
    const duration = asOptionalString(body.duration);
    if (!duration) {
      throw new AdminApiInputError("Missing duration for timed role add");
    }

    return { action, guildId, userId, roleId, duration };
  }

  if (action === "remove") {
    return { action, guildId, userId, roleId };
  }

  throw new AdminApiInputError("Invalid action. Use 'add' or 'remove'");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AdminApiInputError(`Missing ${fieldName}`);
  }

  return value;
}

function asNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return asRequiredString(value, fieldName);
}

function asOptionalNullableString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = asRequiredString(value, fieldName).trim();
  return normalized.length > 0 ? normalized : null;
}

function asBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AdminApiInputError(`Missing ${fieldName}`);
  }

  return value;
}

function parseTicketTypes(value: unknown): TicketPanelConfig["ticketTypes"] {
  if (!Array.isArray(value)) {
    throw new AdminApiInputError("Missing ticketTypes");
  }

  const seenIds = new Set<string>();
  return value.map((ticketType, index) => {
    if (!isRecord(ticketType)) {
      throw new AdminApiInputError(`Invalid ticketTypes[${index}]`);
    }

    const id = asRequiredString(ticketType.id, `ticketTypes[${index}].id`);
    if (seenIds.has(id)) {
      throw new AdminApiInputError(`Duplicate ticketTypes[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(ticketType.label, `ticketTypes[${index}].label`),
      emoji: asNullableString(ticketType.emoji, `ticketTypes[${index}].emoji`),
      buttonStyle: asTicketButtonStyle(ticketType.buttonStyle),
      supportRoleId: asRequiredString(ticketType.supportRoleId, `ticketTypes[${index}].supportRoleId`),
      channelNamePrefix: asRequiredString(ticketType.channelNamePrefix, `ticketTypes[${index}].channelNamePrefix`),
      questions: parseTicketQuestions(ticketType.questions, index),
    };
  });
}

function parseTicketQuestions(
  value: unknown,
  ticketTypeIndex: number
): TicketQuestion[] {
  if (!Array.isArray(value)) {
    throw new AdminApiInputError(`Missing ticketTypes[${ticketTypeIndex}].questions`);
  }
  if (value.length > 5) {
    throw new AdminApiInputError(`ticketTypes[${ticketTypeIndex}].questions cannot exceed 5 entries`);
  }

  return value.map((question, questionIndex) => {
    if (!isRecord(question)) {
      throw new AdminApiInputError(
        `Invalid ticketTypes[${ticketTypeIndex}].questions[${questionIndex}]`
      );
    }

    return {
      id: asRequiredString(question.id, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].id`),
      label: asRequiredString(question.label, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].label`),
      style: asTicketQuestionStyle(question.style),
      placeholder: asNullableString(
        question.placeholder,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].placeholder`
      ),
      required: asBoolean(
        question.required,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].required`
      ),
    };
  });
}

function getMissingTicketPanelTargets(
  panel: TicketPanelConfig,
  resources: GuildTicketResources
): string[] {
  const categoryIds = new Set(
    resources.channels.filter((channel) => channel.type === 4).map((channel) => channel.id)
  );
  const textChannelIds = new Set(
    resources.channels.filter((channel) => channel.type === 0).map((channel) => channel.id)
  );
  const roleIds = new Set(resources.roles.map((role) => role.id));
  const missing: string[] = [];

  if (!textChannelIds.has(panel.panelChannelId)) {
    missing.push(`panelChannelId ${panel.panelChannelId}`);
  }
  if (!categoryIds.has(panel.categoryChannelId)) {
    missing.push(`categoryChannelId ${panel.categoryChannelId}`);
  }
  if (!textChannelIds.has(panel.transcriptChannelId)) {
    missing.push(`transcriptChannelId ${panel.transcriptChannelId}`);
  }

  panel.ticketTypes.forEach((ticketType, index) => {
    if (!roleIds.has(ticketType.supportRoleId)) {
      missing.push(`ticketTypes[${index}].supportRoleId ${ticketType.supportRoleId}`);
    }
  });

  return missing;
}

function asTicketButtonStyle(value: unknown): TicketTypeConfig["buttonStyle"] {
  if (value !== "primary" && value !== "secondary" && value !== "success" && value !== "danger") {
    throw new AdminApiInputError("Missing buttonStyle");
  }

  return value;
}

function asTicketQuestionStyle(value: unknown): TicketQuestion["style"] {
  if (value !== "short" && value !== "paragraph") {
    throw new AdminApiInputError("Missing style");
  }

  return value;
}

function getInteractionCustomId(interaction: DiscordInteraction): string | null {
  if (!isRecord(interaction.data)) {
    return null;
  }

  return asOptionalString(interaction.data.custom_id);
}

function getInteractionUserId(interaction: DiscordInteraction): string | null {
  return asOptionalString(interaction.member?.user?.id) ?? asOptionalString(interaction.user?.id);
}

function getInteractionMemberRoles(interaction: DiscordInteraction): string[] {
  if (!Array.isArray(interaction.member?.roles)) {
    return [];
  }

  return interaction.member.roles.filter((roleId): roleId is string => typeof roleId === "string");
}

function buildTicketOpeningMessage(instance: TicketInstance) {
  const answerLines =
    instance.answers.length === 0
      ? ["Submitted Answers:", "- No answers provided."]
      : [
          "Submitted Answers:",
          ...instance.answers.map((answer) => `- ${answer.label}: ${answer.value || "(blank)"}`),
        ];

  return {
    content: [
      `<@${instance.openerUserId}> opened a new ticket.`,
      `Ticket Type: ${instance.ticketTypeLabel} (${instance.ticketTypeId})`,
      `Opened by: <@${instance.openerUserId}>`,
      ...answerLines,
    ].join("\n"),
    allowed_mentions: { users: [instance.openerUserId] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: buildTicketCloseCustomId(instance.channelId),
            label: "Close Ticket",
            style: 4,
          },
        ],
      },
    ],
  };
}

function buildTicketPanelMessage(panel: TicketPanelConfig) {
  const embed = buildTicketPanelEmbed(panel);

  return {
    content: embed ? "" : "Open a ticket by choosing the option that fits your request.",
    embeds: embed ? [embed] : [],
    components: chunkTicketTypeButtons(panel.ticketTypes).map((row) => ({
      type: 1,
      components: row.map((ticketType) => ({
        type: 2,
        custom_id: buildTicketOpenCustomId(ticketType.id),
        label: ticketType.label,
        style: mapTicketButtonStyle(ticketType.buttonStyle),
        ...(ticketType.emoji ? { emoji: { name: ticketType.emoji } } : {}),
      })),
    })),
  };
}

function buildTicketPanelEmbed(panel: TicketPanelConfig) {
  if (!panel.panelTitle && !panel.panelDescription && !panel.panelFooter) {
    return null;
  }

  return {
    color: 0x57f287,
    ...(panel.panelTitle ? { title: panel.panelTitle } : {}),
    ...(panel.panelDescription ? { description: panel.panelDescription } : {}),
    ...(panel.panelFooter ? { footer: { text: panel.panelFooter } } : {}),
  };
}

function chunkTicketTypeButtons(ticketTypes: TicketTypeConfig[]): TicketTypeConfig[][] {
  const rows: TicketTypeConfig[][] = [];

  for (let index = 0; index < ticketTypes.length; index += 5) {
    rows.push(ticketTypes.slice(index, index + 5));
  }

  return rows;
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

  return messages.sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  );
}

function mapTicketButtonStyle(style: TicketTypeConfig["buttonStyle"]): 1 | 2 | 3 | 4 {
  switch (style) {
    case "secondary":
      return 2;
    case "success":
      return 3;
    case "danger":
      return 4;
    case "primary":
    default:
      return 1;
  }
}

async function publishTicketPanel(
  panel: TicketPanelConfig,
  discordBotToken: string
): Promise<string> {
  const message = buildTicketPanelMessage(panel);

  if (panel.panelMessageId) {
    try {
      const refreshed = await updateDiscordChannelMessage(
        panel.panelChannelId,
        panel.panelMessageId,
        message,
        discordBotToken
      );
      return refreshed.id;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const created = await createDiscordChannelMessage(panel.panelChannelId, message, discordBotToken);
  return created.id;
}

async function createDiscordChannelMessage(
  channelId: string,
  body: Record<string, unknown>,
  discordBotToken: string
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${discordBotToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseDiscordJsonResponse(response, "Failed to create channel message");
}

async function updateDiscordChannelMessage(
  channelId: string,
  messageId: string,
  body: Record<string, unknown>,
  discordBotToken: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${discordBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return parseDiscordJsonResponse(response, "Failed to update channel message");
}

async function parseDiscordJsonResponse<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const details = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(`${message}: ${response.status} ${details}`, response.status, details);
  }

  return response.json() as Promise<T>;
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

function describeTimedRoleRemovalFailure(error: unknown): string {
  if (!(error instanceof DiscordApiError)) {
    return "Failed to remove the timed role.";
  }

  if (error.status === 403) {
    return "Failed to remove the timed role. Ensure the bot has Manage Roles and that its highest role is above the target role.";
  }

  if (error.status === 404) {
    return "Failed to remove the timed role. The member or role could not be found in this server.";
  }

  if (error.status >= 500) {
    return "Failed to remove the timed role because Discord is currently unavailable.";
  }

  return `Failed to remove the timed role (${error.status}).`;
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
