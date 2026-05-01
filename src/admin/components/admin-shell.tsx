import { useState, type ReactNode } from "react";

import { ADMIN_DASHBOARD_ROUTES, type AdminDashboardPath } from "../dashboard-routes";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { GuildPicker } from "./guild-picker";
import {
  ActivityIcon,
  BanIcon,
  ClockIcon,
  LayoutDashboardIcon,
  LogOutIcon,
  MenuIcon,
  ShieldIcon,
  TicketIcon,
  XIcon,
} from "./ui/icons";
import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";

const ROUTE_ICONS: Record<AdminDashboardPath, (props: { className?: string }) => JSX.Element> = {
  "/admin": (props) => <LayoutDashboardIcon {...props} />,
  "/admin/gateway": (props) => <ActivityIcon {...props} />,
  "/admin/blocklist": (props) => <BanIcon {...props} />,
  "/admin/timed-roles": (props) => <ClockIcon {...props} />,
  "/admin/tickets": (props) => <TicketIcon {...props} />,
};

export function AdminShell({
  currentPath,
  guildDirectory,
  guildLookupError,
  selectedGuildId,
  onSelectedGuildChange,
  buildNavigationHref,
  onNavigate,
  children,
}: {
  currentPath: AdminDashboardPath;
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
  selectedGuildId: string;
  onSelectedGuildChange: (nextGuildId: string) => void;
  buildNavigationHref: (path: AdminDashboardPath) => string;
  onNavigate: (path: AdminDashboardPath) => void;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background" data-current-path={currentPath}>
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 flex-col sm:px-6 lg:flex-row lg:px-8">
        <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm lg:hidden">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Discord Automation
              </p>
              <h1 className="text-base font-semibold tracking-tight">Admin Dashboard</h1>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 lg:hidden"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            {mobileNavOpen ? <XIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
          </Button>
        </div>
        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[18rem] max-w-[calc(100vw-2rem)] flex-col overflow-y-auto border bg-card p-5 text-card-foreground shadow-xl transition-transform lg:static lg:z-auto lg:flex lg:w-full lg:max-w-xs lg:translate-x-0 lg:rounded-lg lg:shadow-sm",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
          )}
        >
          <div className="flex items-center gap-3">
            <BrandMark />
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Discord Automation
              </p>
              <h1 className="text-base font-semibold tracking-tight">Admin Dashboard</h1>
            </div>
          </div>
          <div className="mt-6 space-y-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Current server</p>
              <p className="text-xs text-muted-foreground">
                Pick one server here and keep it across the admin pages.
              </p>
            </div>
            <GuildPicker
              id="sidebar-guild"
              value={selectedGuildId}
              guildDirectory={guildDirectory}
              loadError={guildLookupError}
              onChange={onSelectedGuildChange}
            />
          </div>
          <nav className="mt-6 flex-1 space-y-1" aria-label="Admin">
            <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Workspace
            </p>
            {ADMIN_DASHBOARD_ROUTES.map((route) => {
              const active = route.path === currentPath;
              const Icon = ROUTE_ICONS[route.path];

              return (
                <a
                  key={route.path}
                  href={buildNavigationHref(route.path)}
                  aria-current={active ? "page" : undefined}
                  onClick={(event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }

                    event.preventDefault();
                    onNavigate(route.path);
                    setMobileNavOpen(false);
                  }}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {route.label}
                  <Icon
                    className={cn(
                      "order-first h-4 w-4 transition-colors",
                      active
                        ? "text-primary-foreground"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
                </a>
              );
            })}
          </nav>
          <form className="mt-6 border-t pt-4" method="post" action="/admin/logout">
            <Button className="w-full gap-2" type="submit" variant="outline">
              <LogOutIcon className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}

function BrandMark() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted/40 text-foreground shadow-inner">
      <ShieldIcon className="h-4 w-4" />
    </span>
  );
}
