import { useEffect, useRef, useState } from "react";

import type { TicketPanelConfig } from "../../types";
import { TicketPanelEditor, type GuildResources } from "./ticket-panel-editor";
import { AdminPageHeader } from "./admin-page-header";
import { NoGuildSelected } from "./no-guild-selected";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { RefreshIcon } from "./ui/icons";

export function AdminTicketsPage({ selectedGuildId }: { selectedGuildId: string }) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Tickets"
        description="Load and publish the ticket panel workspace for a specific server."
      />

      <PermissionNotice selectedGuildId={selectedGuildId} feature="tickets" />
      <TicketPanelsEditor selectedGuildId={selectedGuildId} />
    </section>
  );
}

function emptyPanelConfig(guildId: string): TicketPanelConfig {
  return {
    guildId,
    panelChannelId: "",
    categoryChannelId: "",
    transcriptChannelId: "",
    panelEmoji: null,
    panelTitle: null,
    panelDescription: null,
    panelFooter: null,
    panelMessageId: null,
    ticketTypes: [],
  };
}

function TicketPanelsEditor({ selectedGuildId }: { selectedGuildId: string }) {
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [panelConfig, setPanelConfig] = useState<TicketPanelConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedGuildId, setLoadedGuildId] = useState<string>("");
  const trimmedGuildId = selectedGuildId.trim();
  const requestRef = useRef(0);

  async function loadResources(id: string, refreshDiscordCache = false) {
    const normalized = id.trim();
    if (!normalized) {
      setGuildResources(null);
      setPanelConfig(null);
      setLoadedGuildId("");
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const [resourcesRes, panelRes] = await Promise.all([
        fetch(buildTicketResourcesApiPath(normalized, refreshDiscordCache)),
        fetch(`/admin/api/tickets/panel?guildId=${encodeURIComponent(normalized)}`),
      ]);
      if (requestRef.current !== requestId) return;
      if (!resourcesRes.ok) {
        throw new Error(`Failed to load guild resources (${resourcesRes.status})`);
      }

      const resources = (await resourcesRes.json()) as GuildResources;
      if (requestRef.current !== requestId) return;
      setGuildResources(resources);

      if (panelRes.ok) {
        const data = (await panelRes.json()) as { panel: TicketPanelConfig | null };
        if (requestRef.current !== requestId) return;
        setPanelConfig(data.panel ?? emptyPanelConfig(normalized));
      } else {
        setPanelConfig(emptyPanelConfig(normalized));
      }
      setLoadedGuildId(normalized);
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setLoadError(error instanceof Error ? error.message : "Failed to load guild data.");
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!trimmedGuildId) {
      requestRef.current++;
      setGuildResources(null);
      setPanelConfig(null);
      setLoadedGuildId("");
      setLoadError(null);
      setLoading(false);
      return;
    }
    if (trimmedGuildId === loadedGuildId) return;
    void loadResources(trimmedGuildId, false);
  }, [trimmedGuildId, loadedGuildId]);

  async function handleSave() {
    if (!panelConfig) {
      return;
    }

    const res = await fetch("/admin/api/tickets/panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(panelConfig),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `Save failed (${res.status})`);
    }
  }

  async function handlePublish() {
    if (!panelConfig) {
      return;
    }

    const res = await fetch("/admin/api/tickets/panel/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: panelConfig.guildId }),
    });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? `Publish failed (${res.status})`);
    }
  }

  if (!trimmedGuildId) {
    return (
      <NoGuildSelected
        feature="ticket panel"
        description="Pick a server from the sidebar to load its ticket panel. We will fetch live Discord data automatically."
      />
    );
  }

  if (loadError && !guildResources) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <Alert variant="destructive">
            <AlertDescription>{loadError}</AlertDescription>
          </Alert>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            disabled={loading}
            onClick={() => void loadResources(trimmedGuildId, true)}
          >
            <RefreshIcon className="h-4 w-4" />
            Load ticket panel
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading && !guildResources) {
    return <TicketPanelSkeleton />;
  }

  if (!guildResources || !panelConfig) {
    return <TicketPanelSkeleton />;
  }

  return (
    <div className="space-y-4">
      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Loaded from Discord. Edits stay local until you save or publish.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={loading}
          onClick={() => void loadResources(trimmedGuildId, true)}
          title="Load ticket panel"
        >
          <RefreshIcon className="h-4 w-4" />
          {loading ? "Reloading…" : "Reload from Discord"}
        </Button>
      </div>
      <TicketPanelEditor
        guildResources={guildResources}
        value={panelConfig}
        onChange={setPanelConfig}
        onSave={handleSave}
        onPublish={handlePublish}
      />
    </div>
  );
}

function TicketPanelSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="flex items-center justify-between">
          <SkeletonBar className="h-3 w-48" />
          <SkeletonBar className="h-9 w-44" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <SkeletonField />
          <SkeletonField />
          <SkeletonField />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SkeletonField />
          <SkeletonField />
        </div>
        <SkeletonField tall />
        <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
          <SkeletonBar className="h-4 w-32" />
          <SkeletonBar className="h-3 w-72" />
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonField({ tall = false }: { tall?: boolean }) {
  return (
    <div className="space-y-2">
      <SkeletonBar className="h-3 w-24" />
      <SkeletonBar className={tall ? "h-24 w-full" : "h-10 w-full"} />
    </div>
  );
}

function SkeletonBar({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted/40 ${className}`.trim()} />;
}

export function buildTicketResourcesApiPath(guildId: string, refreshDiscordCache: boolean): string {
  const params = new URLSearchParams({ guildId });
  if (refreshDiscordCache) {
    params.set("refresh", "1");
  }
  return `/admin/api/tickets/resources?${params.toString()}`;
}
