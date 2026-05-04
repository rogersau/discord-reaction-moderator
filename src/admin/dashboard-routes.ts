export const ADMIN_DASHBOARD_ROUTES = [
  { path: "/admin", label: "Overview" },
  { path: "/admin/gateway", label: "Gateway" },
  { path: "/admin/blocklist", label: "Blocklist" },
  { path: "/admin/timed-roles", label: "Timed Roles" },
  { path: "/admin/tickets", label: "Tickets" },
  { path: "/admin/marketplace", label: "Marketplace" },
  { path: "/admin/lfg", label: "LFG" },
] as const;

export type AdminDashboardPath = (typeof ADMIN_DASHBOARD_ROUTES)[number]["path"];

export function isAdminDashboardPath(pathname: string): pathname is AdminDashboardPath {
  return ADMIN_DASHBOARD_ROUTES.some((route) => route.path === pathname);
}

export function normalizeAdminDashboardPath(pathname: string): AdminDashboardPath {
  return isAdminDashboardPath(pathname) ? pathname : "/admin";
}
