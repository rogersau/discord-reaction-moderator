import { useState, type ReactNode } from "react";

import {
  ADMIN_DASHBOARD_ROUTES,
  type AdminDashboardPath,
} from "../dashboard-routes";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { GuildPicker } from "./guild-picker";
import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";

export function AdminShell({
  currentPath,
  guildDirectory,
  guildLookupError,
  selectedGuildId,
  onSelectedGuildChange,
  buildNavigationHref,
  children,
}: {
  currentPath: AdminDashboardPath;
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
  selectedGuildId: string;
  onSelectedGuildChange: (nextGuildId: string) => void;
  buildNavigationHref: (path: AdminDashboardPath) => string;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <main className="min-h-screen bg-background" data-current-path={currentPath}>
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 flex-col sm:px-6 lg:flex-row lg:px-8">
        <div className="flex items-center justify-between rounded-lg border bg-card p-4 text-card-foreground shadow-sm lg:hidden">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Discord Automation
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Admin Dashboard</h1>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="lg:hidden"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span className="flex flex-col gap-1">
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
              <span className="block h-0.5 w-5 bg-current" />
            </span>
          </Button>
        </div>
        {mobileNavOpen ? (
          <button
            type="button"
            aria-label="Close navigation menu"
            className="fixed inset-0 z-40 bg-background/80 lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        ) : null}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-50 w-[18rem] max-w-[calc(100vw-2rem)] overflow-y-auto border bg-card p-4 text-card-foreground shadow-sm transition-transform lg:static lg:z-auto lg:block lg:w-full lg:max-w-xs lg:translate-x-0 lg:rounded-lg",
            mobileNavOpen ? "translate-x-0" : "-translate-x-full",
            "lg:border"
          )}
        >
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Discord Automation
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Admin Dashboard</h1>
          </div>
          <div className="mt-6 space-y-3 border-t pt-4">
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
          <nav className="mt-6 space-y-1" aria-label="Admin">
            {ADMIN_DASHBOARD_ROUTES.map((route) => {
              const active = route.path === currentPath;

              return (
                <a
                  key={route.path}
                  href={buildNavigationHref(route.path)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {route.label}
                </a>
              );
            })}
          </nav>
          <form className="mt-6 border-t pt-4" method="post" action="/admin/logout">
            <Button className="w-full" type="submit" variant="outline">
              Sign out
            </Button>
          </form>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
