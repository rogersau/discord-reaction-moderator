import { useState } from "react";

import type { TicketPanelConfig } from "../../types";
import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";
import { TicketPanelEditor, type GuildResources } from "./ticket-panel-editor";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel } from "./admin-form-layout";
import { GuildPicker } from "./guild-picker";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

export function AdminTicketsPage({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Tickets"
        description="Load and publish the ticket panel workspace for a specific server."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <TicketPanelsEditor
            guildDirectory={guildDirectory}
            guildLookupError={guildLookupError}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function TicketPanelsEditor({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
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
      <EditorPanel>
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
        <EditorActions>
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            disabled={!trimmedGuildId || loading}
            onClick={() => void loadResources(guildId)}
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
