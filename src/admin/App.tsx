import { useCallback, useEffect, useRef, useState } from "react";
import {
  startGatewayStatusMonitor,
  type GatewayStatusMonitor,
} from "../admin-gateway-monitor";
import { AdminBlocklistPage } from "./components/admin-blocklist-page";
import { AdminGatewayPage } from "./components/admin-gateway-page";
import { AdminOverviewPage } from "./components/admin-overview-page";
import { AdminShell } from "./components/admin-shell";
import { AdminTicketsPage } from "./components/admin-tickets-page";
import { AdminTimedRolesPage } from "./components/admin-timed-roles-page";
import { cn } from "./lib/utils";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { type AdminOverviewGuild } from "./components/guild-overview-card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import type {
  AdminGuildDirectoryEntry,
  AdminGuildDirectoryResponse,
} from "../runtime/admin-types";
import { normalizeAdminDashboardPath } from "./dashboard-routes";

interface GatewayStatus {
  status: string;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

interface AdminOverview {
  gateway: GatewayStatus;
  guilds: AdminOverviewGuild[];
}

interface Props {
  initialAuthenticated?: boolean;
  initialPath?: string;
}

export default function App({
  initialAuthenticated = false,
  initialPath = "/admin",
}: Props) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const currentPath = normalizeAdminDashboardPath(initialPath);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [guildDirectory, setGuildDirectory] =
    useState<AdminGuildDirectoryEntry[] | null>(null);
  const [guildLookupError, setGuildLookupError] = useState<string | null>(null);
  const gatewayMonitorRef = useRef<GatewayStatusMonitor | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      const nextOverview = await readJsonOrThrow<AdminOverview>("/admin/api/overview");
      setOverview(nextOverview);
      setOverviewError(null);
      setGatewayStatus(nextOverview.gateway);
      setGatewayError(null);
    } catch (error) {
      setOverviewError(describeError(error));
    }
  }, []);

  useEffect(() => {
    if (!authenticated) {
      gatewayMonitorRef.current = null;
      setGatewayStatus(null);
      setOverview(null);
      setGatewayError(null);
      setOverviewError(null);
      setGuildDirectory(null);
      setGuildLookupError(null);
      return;
    }

    let cancelled = false;
    void loadOverview().catch(() => undefined);

    const monitor = startGatewayStatusMonitor({
      intervalMs: 2000,
      loadStatus() {
        return readJsonOrThrow<GatewayStatus>("/admin/api/gateway/status");
      },
      onStatus(status) {
        if (cancelled) {
          return;
        }
        setGatewayStatus(status);
        setGatewayError(null);
      },
      onError(error) {
        if (cancelled) {
          return;
        }
        setGatewayError(describeError(error));
      },
      setInterval(callback, delayMs) {
        return window.setInterval(callback, delayMs);
      },
      clearInterval(timer) {
        window.clearInterval(timer as number);
      },
    });
    gatewayMonitorRef.current = monitor;

    return () => {
      cancelled = true;
      gatewayMonitorRef.current = null;
      monitor.stop();
    };
  }, [authenticated, loadOverview]);

  useEffect(() => {
    if (!authenticated) {
      setGuildDirectory(null);
      setGuildLookupError(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await readJsonOrThrow<AdminGuildDirectoryResponse>("/admin/api/guilds");
        if (!cancelled) {
          setGuildDirectory(response.guilds);
          setGuildLookupError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setGuildDirectory(null);
          setGuildLookupError(describeError(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  async function handleLogin() {
    setLoginError(false);
    const res = await fetch("/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(password)}`,
      redirect: "follow",
    });
    if (res.ok || res.redirected) {
      setAuthenticated(true);
    } else {
      setLoginError(true);
    }
  }

  async function handleGatewayStart() {
    await readJsonOrThrow("/admin/api/gateway/start", { method: "POST" });
    await Promise.all([gatewayMonitorRef.current?.refresh(), loadOverview()]);
  }

  if (authenticated) {
    const guildNamesById = new Map(
      (guildDirectory ?? []).map((guild) => [guild.guildId, guild.name] as const)
    );

    return (
      <AdminShell currentPath={currentPath}>
        {currentPath === "/admin" ? (
          <AdminOverviewPage
            gatewayStatus={gatewayError ? null : gatewayStatus}
            overview={overview}
            overviewError={combineDashboardErrors(overviewError, gatewayError)}
            directoryError={guildLookupError}
            guildNamesById={guildNamesById}
            onStartGateway={handleGatewayStart}
            onRefresh={loadOverview}
          />
        ) : null}
        {currentPath === "/admin/gateway" ? (
          <AdminGatewayPage
            gatewayStatus={gatewayStatus}
            gatewayError={gatewayError}
            onStartGateway={handleGatewayStart}
            onRefresh={loadOverview}
          />
        ) : null}
        {currentPath === "/admin/blocklist" ? (
          <AdminBlocklistPage
            guildDirectory={guildDirectory}
            guildLookupError={guildLookupError}
            onUpdated={loadOverview}
          />
        ) : null}
        {currentPath === "/admin/timed-roles" ? (
          <AdminTimedRolesPage
            guildDirectory={guildDirectory}
            guildLookupError={guildLookupError}
            onUpdated={loadOverview}
          />
        ) : null}
        {currentPath === "/admin/tickets" ? (
          <AdminTicketsPage
            guildDirectory={guildDirectory}
            guildLookupError={guildLookupError}
          />
        ) : null}
      </AdminShell>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4 sm:p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
          <p className="text-sm text-muted-foreground">
            Use the admin secret to access gateway controls, blocklists, and timed roles.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="Enter admin password"
              />
            </div>
            <Button className="w-full" onClick={handleLogin}>
              Sign in
            </Button>
            {loginError && (
              <Alert variant="destructive">
                <AlertDescription>Incorrect password. Please try again.</AlertDescription>
              </Alert>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export function combineDashboardErrors(...errors: Array<string | null>): string | null {
  const combined = errors.filter((error): error is string => Boolean(error)).join(" ");
  return combined.length > 0 ? combined : null;
}

export function GatewayDetails({ status }: { status: GatewayStatus }) {
  const details = [
    ["Session ID", status.sessionId ?? "Not established"],
    ["Last sequence", status.lastSequence ?? "None"],
    ["Heartbeat interval", formatHeartbeatInterval(status.heartbeatIntervalMs)],
    ["Backoff attempt", String(status.backoffAttempt)],
    ["Resume URL", status.resumeGatewayUrl ?? "Default gateway URL"],
    ["Last error", status.lastError ?? "None"],
  ] satisfies Array<[string, string | number]>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
        <span className="text-xs font-medium text-muted-foreground">Current state</span>
        <StatusBadge status={status.status} />
        <p className="text-sm text-muted-foreground">
          {status.lastError
            ? "The gateway reported an error. Review the details below."
            : "Session telemetry is available and up to date."}
        </p>
      </div>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {details.map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-background p-4">
            <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function SummaryChip({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: StatusTone;
}) {
  return (
    <div
      className={cn(
        "min-w-[8rem] rounded-md border bg-muted/40 px-3 py-2",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10",
        tone === "danger" && "border-destructive/40 bg-destructive/10"
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = getStatusTone(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
        tone === "warning" && "border-amber-500/30 bg-amber-500/10 text-amber-100",
        tone === "danger" && "border-destructive/40 bg-destructive/10 text-destructive-foreground",
        tone === "neutral" && "border-border bg-muted/40 text-foreground"
      )}
    >
      {status}
    </span>
  );
}

type StatusTone = "success" | "warning" | "danger" | "neutral";

function getStatusTone(status: string | null): StatusTone {
  if (!status) {
    return "neutral";
  }

  const normalized = status.toLowerCase();
  if (normalized.includes("ready") || normalized.includes("connected") || normalized.includes("active")) {
    return "success";
  }

  if (normalized.includes("error") || normalized.includes("fail") || normalized.includes("closed")) {
    return "danger";
  }

  if (normalized.includes("backoff") || normalized.includes("start") || normalized.includes("connect")) {
    return "warning";
  }

  return "neutral";
}

async function readJsonOrThrow<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    const message = (await response.text()) || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected dashboard error";
}

function formatHeartbeatInterval(intervalMs: number | null): string {
  if (intervalMs === null) {
    return "Unknown";
  }

  return `${Math.round(intervalMs / 1000)}s`;
}
