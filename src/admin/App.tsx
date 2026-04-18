import { useCallback, useEffect, useRef, useState } from "react";
import {
  startGatewayStatusMonitor,
  type GatewayStatusMonitor,
} from "../admin-gateway-monitor";
import { AdminBlocklistPage } from "./components/admin-blocklist-page";
import { EditorActions, EditorPanel, FormField } from "./components/admin-form-layout";
import { AdminGatewayPage } from "./components/admin-gateway-page";
import { AdminOverviewPage } from "./components/admin-overview-page";
import { AdminShell } from "./components/admin-shell";
import { cn } from "./lib/utils";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
import { type AdminOverviewGuild } from "./components/guild-overview-card";
import { GuildPicker } from "./components/guild-picker";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./components/ui/table";
import { TicketPanelEditor, type GuildResources } from "./components/ticket-panel-editor";
import type { TicketPanelConfig } from "../types";
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

interface TimedRoleAssignment {
  guildId: string;
  userId: string;
  roleId: string;
  durationInput: string;
  expiresAtMs: number;
}

interface AdminOverview {
  gateway: GatewayStatus;
  guilds: AdminOverviewGuild[];
}

interface GuildSelectionProps {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
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

export function TimedRolesEditor({
  guildDirectory,
  guildLookupError,
  onUpdated,
}: GuildSelectionProps & { onUpdated: () => Promise<void> }) {
  const [guildId, setGuildId] = useState("");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [duration, setDuration] = useState("1h");
  const [assignments, setAssignments] = useState<TimedRoleAssignment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmedGuildId = guildId.trim();

  async function loadAssignments(nextGuildId: string) {
    const trimmedGuildId = nextGuildId.trim();
    setMessage(null);
    setError(null);

    if (!trimmedGuildId) {
      setAssignments(null);
      return;
    }

    const res = await fetch(`/admin/api/timed-roles?guildId=${encodeURIComponent(trimmedGuildId)}`);
    if (!res.ok) {
      setError("Failed to load timed roles.");
      return;
    }

    const data = await res.json() as { assignments: TimedRoleAssignment[] };
    setAssignments(data.assignments);
  }

  async function handleAdd() {
    setMessage(null);
    setError(null);

    const res = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        guildId,
        userId,
        roleId,
        duration,
      }),
    });

    const data = await res.json() as { assignments?: TimedRoleAssignment[]; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to add the timed role.");
      return;
    }

    setAssignments(data.assignments ?? []);
    setMessage(`Assigned ${roleId} to ${userId} for ${duration}.`);
    await onUpdated();
  }

  async function handleRemove(assignment: TimedRoleAssignment) {
    setMessage(null);
    setError(null);

    const res = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        guildId: assignment.guildId,
        userId: assignment.userId,
        roleId: assignment.roleId,
      }),
    });

    const data = await res.json() as { assignments?: TimedRoleAssignment[]; error?: string };
    if (!res.ok) {
      setError(data.error ?? "Failed to remove the timed role.");
      return;
    }

    setAssignments(data.assignments ?? []);
    setMessage(`Removed ${assignment.roleId} from ${assignment.userId}.`);
    await onUpdated();
  }

  return (
    <div className="space-y-4">
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.8fr)]">
          <GuildPicker
            id="tr-guild"
            value={guildId}
            guildDirectory={guildDirectory}
            loadError={guildLookupError}
            onChange={(nextGuildId) => {
              setGuildId(nextGuildId);
              setAssignments(null);
            }}
          />
          <FormField label="User ID" htmlFor="tr-user">
            <Input id="tr-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </FormField>
          <FormField label="Role ID" htmlFor="tr-role">
            <Input id="tr-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} />
          </FormField>
          <FormField label="Duration" htmlFor="tr-duration">
            <Input id="tr-duration" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </FormField>
        </div>
        <EditorActions>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[12rem]"
            variant="outline"
            disabled={!trimmedGuildId}
            onClick={() => void loadAssignments(guildId)}
          >
            Load timed roles
          </Button>
          <Button size="sm" className="w-full sm:w-auto sm:min-w-[12rem]" onClick={() => void handleAdd()}>
            Add timed role
          </Button>
        </EditorActions>
      </EditorPanel>

      {assignments !== null && (
        assignments.length === 0 ? (
          <EmptyState message="No timed roles are active in this guild." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={`${assignment.guildId}:${assignment.userId}:${assignment.roleId}`}>
                  <TableCell>{assignment.userId}</TableCell>
                  <TableCell>{assignment.roleId}</TableCell>
                  <TableCell>{assignment.durationInput}</TableCell>
                  <TableCell>{new Date(assignment.expiresAtMs).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRemove(assignment)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      )}

      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export function TicketPanelsEditor({
  guildDirectory,
  guildLookupError,
}: GuildSelectionProps) {
  const [guildId, setGuildId] = useState("");
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [panelConfig, setPanelConfig] = useState<TicketPanelConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const trimmedGuildId = guildId.trim();

  async function loadResources(id: string) {
    const normalized = id.trim();
    if (!normalized) {
      setGuildResources(null);
      setPanelConfig(null);
      return;
    }
    setLoading(true);
    try {
      setLoadError(null);
      const [resourcesRes, panelRes] = await Promise.all([
        fetch(`/admin/api/tickets/resources?guildId=${encodeURIComponent(normalized)}`),
        fetch(`/admin/api/tickets/panel?guildId=${encodeURIComponent(normalized)}`),
      ]);
      if (!resourcesRes.ok) {
        throw new Error(`Failed to load guild resources (${resourcesRes.status})`);
      }
      const resources = await resourcesRes.json() as GuildResources;
      setGuildResources(resources);

      if (panelRes.ok) {
        const data = await panelRes.json() as { panel: TicketPanelConfig | null };
        setPanelConfig(
          data.panel ?? {
            guildId: normalized,
            panelChannelId: "",
            categoryChannelId: "",
            transcriptChannelId: "",
            panelTitle: null,
            panelDescription: null,
            panelFooter: null,
            panelMessageId: null,
            ticketTypes: [],
          }
        );
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load guild data.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!panelConfig) return;
    const res = await fetch("/admin/api/tickets/panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(panelConfig),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? `Save failed (${res.status})`);
    }
  }

  async function handlePublish() {
    if (!panelConfig) return;
    const res = await fetch("/admin/api/tickets/panel/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: panelConfig.guildId }),
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error ?? `Publish failed (${res.status})`);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">
        <GuildPicker
          id="tp-guild"
          value={guildId}
          guildDirectory={guildDirectory}
          loadError={guildLookupError}
          onChange={(nextGuildId) => {
            setGuildId(nextGuildId);
            setGuildResources(null);
            setPanelConfig(null);
          }}
        />
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            disabled={!trimmedGuildId || loading}
            onClick={() => void loadResources(guildId)}
          >
            {loading ? "Loading…" : "Load ticket panel"}
          </Button>
        </div>
      </div>

      {loadError && (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {guildResources && panelConfig && (
        <TicketPanelEditor
          guildResources={guildResources}
          value={panelConfig}
          onChange={setPanelConfig}
          onSave={handleSave}
          onPublish={handlePublish}
        />
      )}
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

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
      {message}
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
