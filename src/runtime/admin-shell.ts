import { normalizeAdminDashboardPath } from "../admin/dashboard-routes";
import { ADMIN_LOGIN_HTML } from "./admin-bundle";
import { hasValidAdminSession } from "./admin-auth";
import type { RuntimeAppOptions } from "./app-types";

export function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function renderAdminShell(
  authenticated = false,
  initialPath = "/admin",
  initialSearch = "",
): Response {
  const attributes = [
    authenticated ? 'data-authenticated="true"' : "",
    `data-initial-path="${escapeHtmlAttribute(initialPath)}"`,
    `data-initial-search="${escapeHtmlAttribute(initialSearch)}"`,
  ]
    .filter(Boolean)
    .join(" ");
  const html = ADMIN_LOGIN_HTML.replace(
    '<div id="admin-root"></div>',
    `<div id="admin-root" ${attributes}></div>`,
  );
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function getAdminLoginLocation(pathname: string): string {
  const normalizedPath = normalizeAdminDashboardPath(pathname);
  if (normalizedPath === "/admin") {
    return "/admin/login";
  }

  return `/admin/login?next=${encodeURIComponent(normalizedPath)}`;
}

export async function isAdminUiAuthorized(
  request: Request,
  options: Pick<RuntimeAppOptions, "adminSessionSecret" | "adminUiPassword">,
): Promise<boolean> {
  if (!options.adminUiPassword) {
    return true;
  }

  if (!options.adminSessionSecret) {
    return false;
  }

  return hasValidAdminSession(request, options.adminSessionSecret);
}

export async function requireAdminSession(
  request: Request,
  options: Pick<RuntimeAppOptions, "adminSessionSecret" | "adminUiPassword">,
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

export function redirect(location: string, headersInit?: HeadersInit): Response {
  const headers = new Headers(headersInit);
  headers.set("location", location);
  return new Response(null, { status: 302, headers });
}
