import { AdminPageHeader } from "./admin-page-header";
import { Alert, AlertDescription } from "./ui/alert";
import { Badge, StatusDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { PlayIcon, RefreshIcon } from "./ui/icons";

interface GatewayStatus {
  status: string;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

export function AdminGatewayPage({
  gatewayStatus,
  gatewayError,
  onStartGateway,
  onRefresh,
}: {
  gatewayStatus: GatewayStatus | null;
  gatewayError: string | null;
  onStartGateway: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Gateway"
        description="Start the session and inspect live telemetry from the Discord gateway."
      />
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap gap-3">
            <Button className="gap-2" onClick={() => void onStartGateway()}>
              <PlayIcon className="h-4 w-4" />
              Start gateway
            </Button>
            <Button className="gap-2" variant="outline" onClick={() => void onRefresh()}>
              <RefreshIcon className="h-4 w-4" />
              Refresh dashboard
            </Button>
          </div>
          {gatewayError ? (
            <Alert variant="destructive">
              <AlertDescription>{gatewayError}</AlertDescription>
            </Alert>
          ) : null}
          {gatewayStatus ? (
            <GatewayDetails status={gatewayStatus} />
          ) : (
            <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Current state
              </p>
              <p className="mt-2 text-sm text-muted-foreground">Loading gateway status...</p>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function GatewayDetails({ status }: { status: GatewayStatus }) {
  const tone = getStatusTone(status.status);
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
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Current state
        </span>
        <Badge variant={tone === "default" ? "default" : tone}>
          <StatusDot variant={tone === "default" ? "default" : tone} pulse={tone === "success"} />
          {status.status}
        </Badge>
        <p className="text-sm text-muted-foreground">
          {status.lastError
            ? "The gateway reported an error. Review the details below."
            : "Session telemetry is available and up to date."}
        </p>
      </div>
      <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {details.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border bg-background p-4 transition-colors hover:border-border/80"
          >
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </dt>
            <dd className="mt-2 break-words text-sm font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type StatusTone = "success" | "warning" | "danger" | "default";

function getStatusTone(status: string | null): StatusTone {
  if (!status) return "default";

  const normalized = status.toLowerCase();
  if (
    normalized.includes("ready") ||
    normalized.includes("connected") ||
    normalized.includes("active")
  ) {
    return "success";
  }
  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("closed")
  ) {
    return "danger";
  }
  if (
    normalized.includes("backoff") ||
    normalized.includes("start") ||
    normalized.includes("connect")
  ) {
    return "warning";
  }
  return "default";
}

function formatHeartbeatInterval(intervalMs: number | null): string {
  if (intervalMs === null) {
    return "Unknown";
  }

  return `${Math.round(intervalMs / 1000)}s`;
}
