import type { ReactNode } from "react";

import { GuildOverviewCard, type AdminOverviewGuild } from "./guild-overview-card";
import { AdminPageHeader } from "./admin-page-header";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, StatusDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ActivityIcon, ClockIcon, PlayIcon, RefreshIcon, ServerIcon } from "./ui/icons";

interface GatewayStatus {
  status: string;
}

interface AdminOverview {
  guilds: AdminOverviewGuild[];
}

type StatTone = "success" | "warning" | "danger" | "default";

function classifyGatewayTone(status: string | null | undefined): StatTone {
  if (!status) return "default";
  const s = status.toLowerCase();
  if (s.includes("ready") || s.includes("connected") || s.includes("active")) return "success";
  if (s.includes("error") || s.includes("fail") || s.includes("closed")) return "danger";
  if (s.includes("backoff") || s.includes("start") || s.includes("connect")) return "warning";
  return "default";
}

export function AdminOverviewPage({
  gatewayStatus,
  overview,
  overviewError,
  directoryError,
  guildNamesById,
  onStartGateway,
  onRefresh,
}: {
  gatewayStatus: GatewayStatus | null;
  overview: AdminOverview | null;
  overviewError: string | null;
  directoryError: string | null;
  guildNamesById: Map<string, string>;
  onStartGateway: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const totalTimedRoles = overview
    ? overview.guilds.reduce((sum, guild) => sum + guild.timedRoles.length, 0)
    : null;
  const gatewayTone = classifyGatewayTone(gatewayStatus?.status);

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Overview"
        description="Operational overview, gateway health, and quick actions."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Gateway"
          value={gatewayStatus?.status ?? "Loading"}
          icon={<ActivityIcon className="h-4 w-4" />}
          tone={gatewayTone}
          footer={
            gatewayStatus ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <StatusDot
                  variant={gatewayTone === "default" ? "default" : gatewayTone}
                  pulse={gatewayTone === "success"}
                />
                Live session telemetry
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Awaiting status…</span>
            )
          }
        />
        <StatCard
          label="Stored servers"
          value={overview ? String(overview.guilds.length) : "—"}
          icon={<ServerIcon className="h-4 w-4" />}
          tone="default"
          footer={
            <span className="text-xs text-muted-foreground">Servers with persisted data</span>
          }
        />
        <StatCard
          label="Timed roles"
          value={totalTimedRoles === null ? "—" : String(totalTimedRoles)}
          icon={<ClockIcon className="h-4 w-4" />}
          tone="default"
          footer={<span className="text-xs text-muted-foreground">Active assignments tracked</span>}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="sm"
            className="w-full gap-2 sm:w-auto"
            onClick={() => void onStartGateway()}
          >
            <PlayIcon className="h-4 w-4" />
            Start gateway
          </Button>
          <Button
            size="sm"
            className="w-full gap-2 sm:w-auto"
            variant="outline"
            onClick={() => void onRefresh()}
          >
            <RefreshIcon className="h-4 w-4" />
            Refresh dashboard
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Stored server data</CardTitle>
          {overview ? (
            <Badge variant="info">
              {overview.guilds.length} server{overview.guilds.length === 1 ? "" : "s"}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {overviewError ? (
            <Alert variant="destructive">
              <AlertDescription>{overviewError}</AlertDescription>
            </Alert>
          ) : null}
          {directoryError ? (
            <Alert>
              <AlertDescription>
                Server names are unavailable right now, so raw guild IDs may be shown.
              </AlertDescription>
            </Alert>
          ) : null}
          {overview ? (
            overview.guilds.length === 0 ? (
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                No blocklists or timed roles are stored yet.
              </div>
            ) : (
              overview.guilds.map((guild) => (
                <GuildOverviewCard
                  key={guild.guildId}
                  guild={guild}
                  guildName={guildNamesById.get(guild.guildId) ?? null}
                />
              ))
            )
          ) : (
            <p className="text-sm text-muted-foreground">Loading stored server data...</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone,
  footer,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone: StatTone;
  footer?: ReactNode;
}) {
  const ringTone =
    tone === "success"
      ? "ring-emerald-500/20 bg-emerald-500/10 text-emerald-200"
      : tone === "warning"
        ? "ring-amber-500/20 bg-amber-500/10 text-amber-200"
        : tone === "danger"
          ? "ring-destructive/30 bg-destructive/10 text-red-200"
          : "ring-border bg-muted/40 text-muted-foreground";

  return (
    <Card className="transition-colors hover:border-border/80">
      <CardContent className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <span
            className={
              "flex h-8 w-8 items-center justify-center rounded-md ring-1 ring-inset " + ringTone
            }
          >
            {icon}
          </span>
        </div>
        <p className="break-words text-2xl font-semibold tracking-tight text-foreground">{value}</p>
        {footer ? <div className="border-t border-border/60 pt-3">{footer}</div> : null}
      </CardContent>
    </Card>
  );
}
