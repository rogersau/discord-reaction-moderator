import { ADMIN_ASSETS } from "../runtime/admin-bundle";
import {
  ADMIN_SESSION_COOKIE_NAME,
  isValidAdminPassword,
  createAdminSessionCookie,
} from "../runtime/admin-auth";
import {
  isAdminDashboardPath,
  normalizeAdminDashboardPath,
} from "../admin/dashboard-routes";
import { parseTimedRoleDuration } from "../timed-roles";
import { normalizeEmoji } from "../blocklist";
import type { GatewayService } from "../services/gateway-service";
import type { AdminOverviewService } from "../services/admin-overview-service";
import type { BlocklistService } from "../services/blocklist-service";
import type { TimedRoleService } from "../services/timed-role-service";

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
  isAdminUiAuthorized: (request: Request, options: Pick<AdminRouteOptions, "adminSessionSecret" | "adminUiPassword">) => Promise<boolean>;
  requireAdminSession: (request: Request, options: Pick<AdminRouteOptions, "adminSessionSecret" | "getAdminLoginLocation">) => Promise<Response | null>;
}

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

async function handleAdminLogin(
  request: Request,
  options: AdminRouteOptions
): Promise<Response> {
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
    "set-cookie": await createAdminSessionCookie(
      options.adminSessionSecret,
      { secure: url.protocol === "https:" }
    ),
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
        return Response.json(await options.services.adminOverviewService.getOverview());
      }

      if (request.method === "GET" && url.pathname === "/admin/api/blocklist") {
        const guildId = url.searchParams.get("guildId");
        if (!guildId) {
          return Response.json({ error: "guildId is required" }, { status: 400 });
        }

        const guildConfig = await options.services.blocklistService.getGuildBlocklist(guildId);
        return Response.json({ guildId, ...guildConfig });
      }

      if (request.method === "POST" && url.pathname === "/admin/api/blocklist") {
        try {
          const body = await request.json() as { guildId: string; action: "add" | "remove"; emoji: string };
          
          if (!body.guildId || !body.emoji || !body.action) {
            return Response.json({ error: "Missing guildId, emoji, or action" }, { status: 400 });
          }
          
          if (body.action !== "add" && body.action !== "remove") {
            return Response.json({ error: "Invalid action. Use 'add' or 'remove'" }, { status: 400 });
          }
          
          const normalizedEmoji = normalizeEmoji(body.emoji);
          if (!normalizedEmoji) {
            return Response.json({ error: "Invalid emoji" }, { status: 400 });
          }
          
          await options.services.blocklistService.applyMutation({
            guildId: body.guildId,
            action: body.action,
            emoji: normalizedEmoji,
          });
          
          return Response.json({ ok: true });
        } catch (error) {
          if (error instanceof SyntaxError) {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
          }
          throw error;
        }
      }

      if (request.method === "GET" && url.pathname === "/admin/api/timed-roles") {
        const guildId = url.searchParams.get("guildId");
        if (!guildId) {
          return Response.json({ error: "guildId is required" }, { status: 400 });
        }

        return Response.json({
          guildId,
          assignments: await options.services.timedRoleService.listTimedRoles(guildId),
        });
      }

      if (request.method === "POST" && url.pathname === "/admin/api/timed-roles") {
        try {
          const body = await request.json() as {
            guildId: string;
            userId: string;
            roleId: string;
            action: "add" | "remove";
            duration?: string;
          };

          if (!body.guildId || !body.userId || !body.roleId || !body.action) {
            return Response.json({ error: "Missing guildId, userId, roleId, or action" }, { status: 400 });
          }

          if (body.action !== "add" && body.action !== "remove") {
            return Response.json({ error: "Invalid action. Use 'add' or 'remove'" }, { status: 400 });
          }

          if (body.action === "add") {
            if (!body.duration) {
              return Response.json({ error: "Missing duration for timed role add" }, { status: 400 });
            }
            
            const parsedDuration = parseTimedRoleDuration(body.duration, Date.now());
            if (!parsedDuration) {
              return Response.json(
                { error: "Invalid duration. Use values like 1h, 1w, or 1m." },
                { status: 400 }
              );
            }

            await options.services.timedRoleService.assignTimedRole({
              guildId: body.guildId,
              userId: body.userId,
              roleId: body.roleId,
              durationInput: parsedDuration.durationInput,
              expiresAtMs: parsedDuration.expiresAtMs,
            });
          } else {
            await options.services.timedRoleService.removeTimedRole({
              guildId: body.guildId,
              userId: body.userId,
              roleId: body.roleId,
            });
          }

          return Response.json({
            guildId: body.guildId,
            assignments: await options.services.timedRoleService.listTimedRoles(body.guildId),
          });
        } catch (error) {
          if (error instanceof SyntaxError) {
            return Response.json({ error: "Invalid JSON body" }, { status: 400 });
          }
          throw error;
        }
      }

      return options.handleAdminApiRequest(request, url);
    }

    return null;
  };
}
