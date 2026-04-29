import type {
  AdminGuildDirectoryEntry,
  AdminGuildDirectoryResponse,
  AdminPermissionCheck,
  AdminPermissionCheckResponse,
  AdminPermissionFeature,
} from "./admin-types";
import {
  buildBlocklistPermissionChecks,
  buildTicketPermissionChecks,
  buildTimedRolePermissionChecks,
} from "./admin-permissions";
import {
  getCachedBotGuilds,
  getCachedGuildPermissionContext,
  shouldRefreshAdminDiscordCache,
} from "./admin-discord-cache";
import {
  parseJsonBody,
  parseAppConfigMutation,
} from "./admin-api-validation";
import type { RuntimeStores } from "./app-types";
import { handleTicketPanelAdminRequest } from "./ticket-panel-admin";
import type { BlocklistConfig, TimedRoleAssignment } from "../types";

interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
  permissionChecks: AdminPermissionCheck[];
}

export interface AdminApiHandlerOptions {
  stores: RuntimeStores;
  discordBotToken: string;
}

export function createAdminApiHandler(options: AdminApiHandlerOptions) {
  return async (request: Request, url: URL): Promise<Response | null> => {
    const refreshDiscordCache = shouldRefreshAdminDiscordCache(url);

    if (url.pathname.startsWith("/admin/api/tickets/")) {
      const ticketResponse = await handleTicketPanelAdminRequest(request, url, options);
      if (ticketResponse) {
        return ticketResponse;
      }
    }

    if (request.method === "GET" && url.pathname === "/admin/api/permissions") {
      const guildId = url.searchParams.get("guildId");
      const featureParam = url.searchParams.get("feature");
      if (!guildId) {
        return Response.json({ error: "guildId is required" }, { status: 400 });
      }
      if (!isAdminPermissionFeature(featureParam)) {
        return Response.json({ error: "feature must be blocklist, timed-roles, or tickets" }, { status: 400 });
      }

      try {
        return Response.json(
          await buildAdminPermissionResponse(
            guildId,
            featureParam,
            options.stores,
            options.discordBotToken,
            refreshDiscordCache
          )
        );
      } catch (error) {
        return Response.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Failed to load the bot's current Discord permissions.",
          },
          { status: 502 }
        );
      }
    }

    if (request.method === "GET" && url.pathname === "/admin/api/guilds") {
      const guilds = buildAdminGuildDirectory(
        await getCachedBotGuilds(options.discordBotToken, refreshDiscordCache)
      );
      const body: AdminGuildDirectoryResponse = { guilds };
      return Response.json(body);
    }

    if (request.method === "GET" && url.pathname === "/admin/api/config") {
      const config = await options.stores.blocklist.readConfig();
      return Response.json({ botUserId: config.botUserId });
    }

    if (request.method === "POST" && url.pathname === "/admin/api/config") {
      const parsedBody = await parseJsonBody(request, parseAppConfigMutation);
      if (!parsedBody.ok) {
        return parsedBody.response;
      }

      await options.stores.appConfig.upsertAppConfig(parsedBody.value);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  };
}

export async function buildAdminOverviewGuilds(
  config: BlocklistConfig,
  timedRoles: TimedRoleAssignment[],
  discordBotToken: string,
  refreshDiscordCache = false
): Promise<AdminOverviewGuild[]> {
  const guilds = new Map<string, AdminOverviewGuild>();

  for (const [guildId, guildConfig] of Object.entries(config.guilds)) {
    guilds.set(guildId, {
      guildId,
      emojis: [...guildConfig.emojis],
      timedRoles: [],
      permissionChecks: [],
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
      permissionChecks: [],
    });
  }

  await Promise.all(
    [...guilds.values()].map(async (guild) => {
      if (guild.emojis.length === 0 && guild.timedRoles.length === 0) {
        return;
      }

      try {
        const context = await getCachedGuildPermissionContext(
          guild.guildId,
          config.botUserId,
          discordBotToken,
          refreshDiscordCache
        );
        guild.permissionChecks = [
          ...(guild.emojis.length > 0 ? buildBlocklistPermissionChecks(context) : []),
          ...(guild.timedRoles.length > 0 ? buildTimedRolePermissionChecks(context, guild.timedRoles) : []),
        ].filter((check) => check.status !== "ok");
      } catch (error) {
        guild.permissionChecks = [
          {
            label: "Discord permission check unavailable",
            status: "warning",
            detail:
              error instanceof Error
                ? error.message
                : "Failed to load the bot's current Discord permissions.",
          },
        ];
      }
    })
  );

  return [...guilds.values()].sort((left, right) => left.guildId.localeCompare(right.guildId));
}

async function buildAdminPermissionResponse(
  guildId: string,
  feature: AdminPermissionFeature,
  stores: RuntimeStores,
  discordBotToken: string,
  refreshDiscordCache: boolean
): Promise<AdminPermissionCheckResponse> {
  const config = await stores.blocklist.readConfig();
  const context = await getCachedGuildPermissionContext(
    guildId,
    config.botUserId,
    discordBotToken,
    refreshDiscordCache
  );

  if (feature === "blocklist") {
    return {
      guildId,
      feature,
      checks: buildBlocklistPermissionChecks(context),
    };
  }

  if (feature === "timed-roles") {
    return {
      guildId,
      feature,
      checks: buildTimedRolePermissionChecks(context, await stores.timedRoles.listTimedRolesByGuild(guildId)),
    };
  }

  return {
    guildId,
    feature,
    checks: buildTicketPermissionChecks(context, await stores.tickets.readTicketPanelConfig(guildId)),
  };
}

function isAdminPermissionFeature(value: string | null): value is AdminPermissionFeature {
  return value === "blocklist" || value === "timed-roles" || value === "tickets";
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
