import { useCallback, useEffect, useRef, useState } from "react";
import {
  startGatewayStatusMonitor,
  type GatewayStatusMonitor,
} from "../admin-gateway-monitor";
import { cn } from "./lib/utils";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";
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

interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
}

interface AdminOverview {
  gateway: GatewayStatus;
  guilds: AdminOverviewGuild[];
}

interface Props {
  initialAuthenticated?: boolean;
}

export default function App({ initialAuthenticated = false }: Props) {
  const [authenticated, setAuthenticated] = useState(initialAuthenticated);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
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
    const totalTimedRoles = overview
      ? overview.guilds.reduce((sum, guild) => sum + guild.timedRoles.length, 0)
      : null;

    return (
      <main className="min-h-screen">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 rounded-lg border bg-card p-6 text-card-foreground shadow-sm lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="space-y-1">
                <h1 className="text-3xl font-semibold tracking-tight">Admin Dashboard</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  Monitor gateway health, review stored guild state, and manage moderation controls.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <SummaryChip
                  label="Gateway"
                  value={gatewayStatus?.status ?? "Loading"}
                  tone={getStatusTone(gatewayStatus?.status ?? null)}
                />
                <SummaryChip
                  label="Stored guilds"
                  value={overview ? String(overview.guilds.length) : "-"}
                />
                <SummaryChip
                  label="Timed roles"
                  value={totalTimedRoles === null ? "-" : String(totalTimedRoles)}
                />
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={async () => {
                await fetch("/admin/logout", { method: "POST" });
                window.location.href = "/admin/login";
              }}
            >
              Sign out
            </Button>
          </header>

          <div className="grid gap-6 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
            <section className="space-y-4">
              <SectionHeading
                title="Gateway"
                description="Start the session and watch live telemetry from the Discord gateway."
              />
              <Card>
                <CardContent className="space-y-5 pt-6">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={handleGatewayStart}>Start gateway</Button>
                    <Button size="sm" variant="outline" onClick={() => void loadOverview()}>
                      Refresh dashboard
                    </Button>
                  </div>
                  {gatewayError && (
                    <Alert variant="destructive">
                      <AlertDescription>{gatewayError}</AlertDescription>
                    </Alert>
                  )}
                  {gatewayStatus ? (
                    <GatewayDetails status={gatewayStatus} />
                  ) : (
                    <EmptyState message="Loading gateway status..." />
                  )}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <SectionHeading
                title="Stored Server Data"
                description="Review blocklist coverage and active timed roles across connected guilds."
              />
              <Card>
                <CardContent className="space-y-4 pt-6">
                  {overviewError && (
                    <Alert variant="destructive">
                      <AlertDescription>{overviewError}</AlertDescription>
                    </Alert>
                  )}
                  {overview ? (
                    overview.guilds.length === 0 ? (
                      <EmptyState message="No blocklists or timed roles are stored yet." />
                    ) : (
                      <div className="space-y-4">
                        {overview.guilds.map((guild) => (
                          <GuildOverviewCard key={guild.guildId} guild={guild} />
                        ))}
                      </div>
                    )
                  ) : (
                    <EmptyState message="Loading stored server data..." />
                  )}
                </CardContent>
              </Card>
            </section>
          </div>

          <div className="grid gap-6">
            <section className="space-y-4">
              <SectionHeading
                title="Blocklist"
                description="Load the guild blocklist, then add or remove blocked reaction emoji."
              />
              <Card>
                <CardContent className="pt-6">
                  <BlocklistEditor onUpdated={loadOverview} />
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <SectionHeading
                title="Timed Roles"
                description="Inspect scheduled role assignments and issue new ones without leaving the dashboard."
              />
              <Card>
                <CardContent className="pt-6">
                  <TimedRolesEditor onUpdated={loadOverview} />
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <SectionHeading
                title="Ticket Panels"
                description="Configure ticket buttons, questions, and transcript routing."
              />
              <Card>
                <CardContent className="pt-6">
                  <TicketPanelsEditor />
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </main>
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

function GatewayDetails({ status }: { status: GatewayStatus }) {
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

function GuildOverviewCard({ guild }: { guild: AdminOverviewGuild }) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Guild</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{guild.guildId}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Stored moderation data for this server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
            {guild.emojis.length} blocked emoji{guild.emojis.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-md border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
            {guild.timedRoles.length} timed role{guild.timedRoles.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="rounded-md border bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">Blocked Emoji</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Blocked emojis: {guild.emojis.length === 0 ? "None" : guild.emojis.join(" ")}
        </p>
      </div>
      {guild.timedRoles.length === 0 ? (
        <EmptyState message="No timed roles are active in this guild." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guild.timedRoles.map((assignment) => (
              <TableRow key={`${assignment.guildId}:${assignment.userId}:${assignment.roleId}`}>
                <TableCell>{assignment.userId}</TableCell>
                <TableCell>{assignment.roleId}</TableCell>
                <TableCell>{assignment.durationInput}</TableCell>
                <TableCell>{new Date(assignment.expiresAtMs).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function BlocklistEditor({ onUpdated }: { onUpdated: () => Promise<void> }) {
  const [guildId, setGuildId] = useState("");
  const [emoji, setEmoji] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [currentEmojis, setCurrentEmojis] = useState<string[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const trimmedGuildId = guildId.trim();

  async function loadBlocklist(id: string) {
    const normalizedGuildId = id.trim();
    if (!normalizedGuildId) { setCurrentEmojis(null); return; }
    try {
      const res = await fetch(`/admin/api/blocklist?guildId=${encodeURIComponent(normalizedGuildId)}`);
      if (res.ok) {
        const data = await res.json() as { emojis: string[] };
        setCurrentEmojis(data.emojis);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleSubmit() {
    const res = await fetch("/admin/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId, emoji, action }),
    });
    if (res.ok) {
      const data = await res.json() as { guilds: Record<string, { emojis: string[] }> };
      setCurrentEmojis(data.guilds?.[guildId]?.emojis ?? null);
      setResult(`${action === "add" ? "Blocked" : "Unblocked"} ${emoji} in ${guildId}`);
      await onUpdated();
    }
  }

  return (
    <div className="space-y-4">
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(14rem,0.95fr)]">
          <FormField label="Guild ID" htmlFor="bl-guild">
            <Input
              id="bl-guild"
              value={guildId}
              onChange={(e) => { setGuildId(e.target.value); setCurrentEmojis(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void loadBlocklist(guildId);
                }
              }}
            />
          </FormField>
          <FormField label="Emoji" htmlFor="bl-emoji">
            <Input id="bl-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </FormField>
          <FormField label="Action">
            <div className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-1.5">
              <Button
                size="sm"
                variant={action === "add" ? "default" : "outline"}
                onClick={() => setAction("add")}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant={action === "remove" ? "default" : "outline"}
                onClick={() => setAction("remove")}
              >
                Remove
              </Button>
            </div>
          </FormField>
        </div>
        <EditorActions>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[11rem]"
            variant="outline"
            disabled={!trimmedGuildId}
            onClick={() => void loadBlocklist(guildId)}
          >
            Load blocklist
          </Button>
          <Button size="sm" className="w-full sm:w-auto sm:min-w-[10rem]" onClick={handleSubmit}>
            Apply
          </Button>
        </EditorActions>
      </EditorPanel>
      {currentEmojis !== null && (
        <div className="rounded-lg border bg-background p-4">
          <p className="text-sm text-muted-foreground">
            {currentEmojis.length === 0
              ? "No emojis currently blocked in this guild."
              : `Currently blocked: ${currentEmojis.join(" ")}`}
          </p>
        </div>
      )}
      {result && (
        <Alert>
          <AlertDescription>{result}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function TimedRolesEditor({ onUpdated }: { onUpdated: () => Promise<void> }) {
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
          <FormField label="Guild ID" htmlFor="tr-guild">
            <Input
              id="tr-guild"
              value={guildId}
              onChange={(e) => {
                setGuildId(e.target.value);
                setAssignments(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  void loadAssignments(guildId);
                }
              }}
            />
          </FormField>
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

function TicketPanelsEditor() {
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
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-2">
            <Label htmlFor="tp-guild">Guild ID</Label>
            <Input
              id="tp-guild"
              value={guildId}
              onChange={(e) => {
                setGuildId(e.target.value);
                setGuildResources(null);
                setPanelConfig(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) {
                  void loadResources(guildId);
                }
              }}
              placeholder="Enter a guild ID to load its ticket panel"
            />
          </div>
        </div>
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

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1.5 px-1">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

function EditorPanel({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">{children}</div>;
}

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {label}
      </Label>
      {children}
    </div>
  );
}

function EditorActions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">{children}</div>;
}

function SummaryChip({
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
