import { ADMIN_ASSETS } from "../runtime/admin-bundle";
import {
  ADMIN_SESSION_COOKIE_NAME,
  isValidAdminPassword,
  createAdminSessionCookie,
} from "../runtime/admin-auth";
import { isAdminDashboardPath, normalizeAdminDashboardPath } from "../admin/dashboard-routes";
import {
  parseTimedRoleDuration,
  describeTimedRoleAssignmentFailure,
  describeTimedRoleRemovalFailure,
} from "../timed-roles";
import { normalizeEmoji } from "../blocklist";
import type { GatewayService } from "../services/gateway-service";
import type { AdminOverviewService } from "../services/admin-overview-service";
import type { BlocklistService } from "../services/blocklist-service";
import type { TimedRoleService } from "../services/timed-role-service";
import {
  parseJsonBody,
  parseBlocklistMutationBody,
  parseGuildNotificationChannelBody,
  parseNewMemberTimedRoleConfigBody,
  parseTimedRoleMutationBody,
} from "../runtime/admin-api-validation";
import { shouldRefreshAdminDiscordCache } from "../runtime/admin-discord-cache";

export interface AdminRouteServices {
  gatewayService: GatewayService;
  adminOverviewService: AdminOverviewService;
  blocklistService: BlocklistService;
  timedRoleService: TimedRoleService;
}

export interface AdminRouteOptions {
  adminSessionSecret?: string;
  adminUiPassword?: string;
  services: AdminRouteServices;
  handleAdminApiRequest: (request: Request, url: URL) => Promise<Response | null>;
  redirect: (location: string, headers?: Record<string, string>) => Response;
  getAdminLoginLocation: (pathname: string) => string;
  renderAdminShell: (withAuth?: boolean, pathname?: string, search?: string) => Response;
  isAdminUiAuthorized: (
    request: Request,
    options: Pick<AdminRouteOptions, "adminSessionSecret" | "adminUiPassword">,
  ) => Promise<boolean>;
  requireAdminSession: (
    request: Request,
    options: Pick<AdminRouteOptions, "adminSessionSecret" | "getAdminLoginLocation">,
  ) => Promise<Response | null>;
}

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

async function handleAdminLogin(request: Request, options: AdminRouteOptions): Promise<Response> {
  if (!options.adminUiPassword || !options.adminSessionSecret) {
    return new Response("Admin login is not configured.", { status: 404 });
  }

  const formData = await request.formData();
  if (!(await isValidAdminPassword(formData.get("password"), options.adminUiPassword))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const next = url.searchParams.get("next");
  const nextPath = !next ? "/admin" : normalizeAdminDashboardPath(next);

  return options.redirect(nextPath, {
    "set-cookie": await createAdminSessionCookie(options.adminSessionSecret, {
      secure: url.protocol === "https:",
    }),
  });
}

export function createAdminRoutes(options: AdminRouteOptions): RouteHandler {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);

    // Admin login GET
    if (request.method === "GET" && url.pathname === "/admin/login") {
      if (options.adminUiPassword && (await options.isAdminUiAuthorized(request, options))) {
        return options.redirect("/admin");
      }
      return options.renderAdminShell();
    }

    // Admin login POST
    if (request.method === "POST" && url.pathname === "/admin/login") {
      return handleAdminLogin(request, options);
    }

    // Admin logout
    if (request.method === "POST" && url.pathname === "/admin/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          location: "/admin/login",
          "set-cookie": `${ADMIN_SESSION_COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
        },
      });
    }

    // Admin dashboard paths
    if (request.method === "GET" && isAdminDashboardPath(url.pathname)) {
      if (!(await options.isAdminUiAuthorized(request, options))) {
        return options.redirect(options.getAdminLoginLocation(url.pathname));
      }
      return options.renderAdminShell(true, normalizeAdminDashboardPath(url.pathname), url.search);
    }

    // Admin assets
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

    // Admin API routes
    if (url.pathname.startsWith("/admin/api/")) {
      const sessionUnauthorized = await options.requireAdminSession(request, options);
      if (sessionUnauthorized) return sessionUnauthorized;

      // Service-delegated admin API handling
      if (request.method === "GET" && url.pathname === "/admin/api/gateway/status") {
        return Response.json(await options.services.gatewayService.getStatus());
      }

      if (request.method === "POST" && url.pathname === "/admin/api/gateway/start") {
        return Response.json(await options.services.gatewayService.bootstrap());
      }

      if (request.method === "GET" && url.pathname === "/admin/api/overview") {
        return Response.json(
          await options.services.adminOverviewService.getOverview(
            shouldRefreshAdminDiscordCache(url),
          ),
        );
      }

      if (request.method === "GET" && url.pathname === "/admin/api/blocklist") {
        const guildId = url.searchParams.get("guildId");
        if (!guildId) {
          return Response.json({ error: "guildId is required" }, { status: 400 });
        }

        const guildConfig = await options.services.blocklistService.getGuildBlocklist(guildId);
        return Response.json({
          guildId,
          ...guildConfig,
          notificationChannelId:
            await options.services.blocklistService.getGuildNotificationChannel(guildId),
        });
      }

      if (request.method === "POST" && url.pathname === "/admin/api/blocklist") {
        const parsedBody = await parseJsonBody(request, parseBlocklistMutationBody);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }

        const normalizedEmoji = normalizeEmoji(parsedBody.value.emoji);
        if (!normalizedEmoji) {
          return Response.json({ error: "Invalid emoji" }, { status: 400 });
        }

        if (parsedBody.value.action === "add") {
          await options.services.blocklistService.addEmoji(
            parsedBody.value.guildId,
            normalizedEmoji,
            { label: "Admin dashboard" },
          );
        } else {
          await options.services.blocklistService.removeEmoji(
            parsedBody.value.guildId,
            normalizedEmoji,
            { label: "Admin dashboard" },
          );
        }

        return Response.json({ ok: true });
      }

      if (request.method === "POST" && url.pathname === "/admin/api/moderation-log-channel") {
        const parsedBody = await parseJsonBody(request, parseGuildNotificationChannelBody);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }

        await options.services.blocklistService.updateGuildNotificationChannel(
          parsedBody.value.guildId,
          parsedBody.value.notificationChannelId,
        );

        return Response.json(parsedBody.value);
      }

      if (request.method === "GET" && url.pathname === "/admin/api/timed-roles") {
        const guildId = url.searchParams.get("guildId");
        if (!guildId) {
          return Response.json({ error: "guildId is required" }, { status: 400 });
        }

        return Response.json({
          guildId,
          assignments: await options.services.timedRoleService.listTimedRoles(guildId),
          notificationChannelId:
            await options.services.blocklistService.getGuildNotificationChannel(guildId),
          newMemberRoleConfig:
            await options.services.timedRoleService.getNewMemberTimedRoleConfig(guildId),
        });
      }

      if (
        request.method === "POST" &&
        url.pathname === "/admin/api/timed-roles/new-member-config"
      ) {
        const parsedBody = await parseJsonBody(request, parseNewMemberTimedRoleConfigBody);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }

        if (parsedBody.value.roleId || parsedBody.value.duration) {
          if (!parsedBody.value.roleId || !parsedBody.value.duration) {
            return Response.json(
              { error: "Role ID and duration are required to enable new member timed roles." },
              { status: 400 },
            );
          }

          const parsedDuration = parseTimedRoleDuration(parsedBody.value.duration, Date.now());
          if (!parsedDuration) {
            return Response.json(
              { error: "Invalid duration. Use values like 1h, 1w, or 1m." },
              { status: 400 },
            );
          }
        }

        await options.services.timedRoleService.updateNewMemberTimedRoleConfig({
          guildId: parsedBody.value.guildId,
          roleId: parsedBody.value.roleId,
          durationInput: parsedBody.value.duration,
        });

        return Response.json({
          newMemberRoleConfig: await options.services.timedRoleService.getNewMemberTimedRoleConfig(
            parsedBody.value.guildId,
          ),
        });
      }

      if (request.method === "POST" && url.pathname === "/admin/api/timed-roles") {
        const parsedBody = await parseJsonBody(request, parseTimedRoleMutationBody);
        if (!parsedBody.ok) {
          return parsedBody.response;
        }

        if (parsedBody.value.action === "add") {
          const parsedDuration = parseTimedRoleDuration(parsedBody.value.duration!, Date.now());
          if (!parsedDuration) {
            return Response.json(
              { error: "Invalid duration. Use values like 1h, 1w, or 1m." },
              { status: 400 },
            );
          }

          try {
            await options.services.timedRoleService.assignTimedRole(
              {
                guildId: parsedBody.value.guildId,
                userId: parsedBody.value.userId,
                roleId: parsedBody.value.roleId,
                durationInput: parsedDuration.durationInput,
                expiresAtMs: parsedDuration.expiresAtMs,
              },
              { label: "Admin dashboard" },
            );
          } catch (error) {
            return Response.json(
              { error: describeTimedRoleAssignmentFailure(error) },
              { status: 502 },
            );
          }
        } else {
          try {
            await options.services.timedRoleService.removeTimedRole(
              {
                guildId: parsedBody.value.guildId,
                userId: parsedBody.value.userId,
                roleId: parsedBody.value.roleId,
              },
              { label: "Admin dashboard" },
            );
          } catch (error) {
            return Response.json(
              { error: describeTimedRoleRemovalFailure(error) },
              { status: 502 },
            );
          }
        }

        return Response.json({
          guildId: parsedBody.value.guildId,
          assignments: await options.services.timedRoleService.listTimedRoles(
            parsedBody.value.guildId,
          ),
          notificationChannelId:
            await options.services.blocklistService.getGuildNotificationChannel(
              parsedBody.value.guildId,
            ),
        });
      }

      return options.handleAdminApiRequest(request, url);
    }

    return null;
  };
}
