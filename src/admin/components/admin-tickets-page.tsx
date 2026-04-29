import { useState } from "react";

import type { TicketPanelConfig } from "../../types";
import { TicketPanelEditor, type GuildResources } from "./ticket-panel-editor";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel } from "./admin-form-layout";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

export function AdminTicketsPage({
  selectedGuildId,
}: {
  selectedGuildId: string;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Tickets"
        description="Load and publish the ticket panel workspace for a specific server."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <PermissionNotice selectedGuildId={selectedGuildId} feature="tickets" />
          <TicketPanelsEditor selectedGuildId={selectedGuildId} />
        </CardContent>
      </Card>
    </section>
  );
}

function TicketPanelsEditor({
  selectedGuildId,
}: {
  selectedGuildId: string;
}) {
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [panelConfig, setPanelConfig] = useState<TicketPanelConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const trimmedGuildId = selectedGuildId.trim();

  async function loadResources(id: string, refreshDiscordCache = false) {
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
        fetch(buildTicketResourcesApiPath(normalized, refreshDiscordCache)),
        fetch(`/admin/api/tickets/panel?guildId=${encodeURIComponent(normalized)}`),
      ]);
      if (!resourcesRes.ok) {
        throw new Error(`Failed to load guild resources (${resourcesRes.status})`);
      }

      const resources = (await resourcesRes.json()) as GuildResources;
      setGuildResources(resources);

      if (panelRes.ok) {
        const data = (await panelRes.json()) as { panel: TicketPanelConfig | null };
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
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load guild data.");
    } finally {
      setLoading(false);
    }
  }

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

  return (
    <div className="space-y-4">
      {!trimmedGuildId ? (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
          Select a server from the sidebar to load its ticket panel workspace.
        </div>
      ) : null}
      <EditorPanel>
        <EditorActions>
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            disabled={!trimmedGuildId || loading}
            onClick={() => void loadResources(selectedGuildId, loadError !== null)}
          >
            {loading ? "Loading…" : "Load ticket panel"}
          </Button>
        </EditorActions>
      </EditorPanel>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {guildResources && panelConfig ? (
        <TicketPanelEditor
          guildResources={guildResources}
          value={panelConfig}
          onChange={setPanelConfig}
          onSave={handleSave}
          onPublish={handlePublish}
        />
      ) : null}
    </div>
  );
}

export function buildTicketResourcesApiPath(
  guildId: string,
  refreshDiscordCache: boolean
): string {
  const params = new URLSearchParams({ guildId });
  if (refreshDiscordCache) {
    params.set("refresh", "1");
  }
  return `/admin/api/tickets/resources?${params.toString()}`;
}
