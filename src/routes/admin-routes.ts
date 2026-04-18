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

export interface AdminRouteOptions {
  adminSessionSecret?: string;
  adminUiPassword?: string;
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

      return options.handleAdminApiRequest(request, url);
    }

    return null;
  };
}
