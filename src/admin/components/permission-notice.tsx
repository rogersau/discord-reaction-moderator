import { useEffect, useState } from "react";

import type {
  AdminPermissionCheck,
  AdminPermissionCheckResponse,
  AdminPermissionFeature,
} from "../../runtime/admin-types";
import { Alert, AlertDescription } from "./ui/alert";

type PermissionNoticeState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; checks: AdminPermissionCheck[] }
  | { kind: "error"; message: string };

export function PermissionNotice({
  selectedGuildId,
  feature,
}: {
  selectedGuildId: string;
  feature: AdminPermissionFeature;
}) {
  const trimmedGuildId = selectedGuildId.trim();
  const [state, setState] = useState<PermissionNoticeState>({ kind: "idle" });

  useEffect(() => {
    if (!trimmedGuildId) {
      setState({ kind: "idle" });
      return;
    }

    let cancelled = false;
    const requestPath =
      `/admin/api/permissions?guildId=${encodeURIComponent(trimmedGuildId)}` +
      `&feature=${encodeURIComponent(feature)}`;

    setState({ kind: "loading" });

    void (async () => {
      try {
        const body = await readPermissionResponse(requestPath);
        if (!cancelled) {
          setState({ kind: "ready", checks: body.checks });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: error instanceof Error ? error.message : "Failed to load permission checks.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feature, trimmedGuildId]);

  if (state.kind === "idle" || state.kind === "loading") {
    return null;
  }

  if (state.kind === "error") {
    return (
      <Alert variant="destructive">
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    );
  }

  const failingChecks = state.checks.filter((check) => check.status !== "ok");
  if (failingChecks.length === 0) {
    return null;
  }

  return (
    <Alert className="border-amber-500/30 bg-amber-500/10">
      <AlertDescription className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">Permission check</p>
          <p className="text-sm text-muted-foreground">
            The bot is missing one or more required Discord permissions for this server.
          </p>
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {failingChecks.map((check) => (
              <span
                key={check.label}
                className={getBadgeClassName(check.status)}
              >
                {check.label}
              </span>
            ))}
          </div>
          <div className="space-y-1">
            {failingChecks.map((check) => (
              <p key={`${check.label}:detail`} className="text-sm text-muted-foreground">
                {check.detail}
              </p>
            ))}
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}

async function readPermissionResponse(path: string): Promise<AdminPermissionCheckResponse> {
  const response = await fetch(path);
  const rawBody = await response.text();
  const parsedBody = parsePermissionBody(rawBody);

  if (!response.ok) {
    throw new Error(
      parsedBody?.error ??
      (looksLikeHtmlError(rawBody)
        ? "Permission check failed right now."
        : rawBody || `Permission check failed (${response.status})`)
    );
  }

  if (!parsedBody) {
    throw new Error("Failed to parse permission checks.");
  }

  return parsedBody;
}

function parsePermissionBody(rawBody: string): (AdminPermissionCheckResponse & { error?: string }) | null {
  if (!rawBody) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as AdminPermissionCheckResponse & { error?: string };
  } catch {
    return null;
  }
}

function looksLikeHtmlError(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith("<!doctype html") || normalized.startsWith("<html");
}

function getBadgeClassName(status: AdminPermissionCheck["status"]) {
  if (status === "ok") {
    return "rounded-md border border-emerald-500/30 bg-background/60 px-2.5 py-1 text-xs font-medium text-emerald-200";
  }

  if (status === "error") {
    return "rounded-md border border-red-500/30 bg-background/60 px-2.5 py-1 text-xs font-medium text-red-200";
  }

  return "rounded-md border border-amber-500/30 bg-background/60 px-2.5 py-1 text-xs font-medium text-amber-100";
}
