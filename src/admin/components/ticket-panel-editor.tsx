import { useState } from "react";
import type { TicketPanelConfig } from "../../types";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export interface GuildResources {
  guildId: string;
  roles: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  textChannels: Array<{ id: string; name: string }>;
}

interface TicketPanelEditorProps {
  guildResources: GuildResources;
  value: TicketPanelConfig;
  onChange: (next: TicketPanelConfig) => void;
  onSave: () => Promise<void>;
  onPublish: () => Promise<void>;
}

function resolveName(
  list: Array<{ id: string; name: string }>,
  id: string | null | undefined
): string {
  if (!id) return "";
  return list.find((item) => item.id === id)?.name ?? id;
}

export function TicketPanelEditor({
  guildResources,
  value,
  onChange,
  onSave,
  onPublish,
}: TicketPanelEditorProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const categoryName = resolveName(guildResources.categories, value.categoryChannelId);
  const transcriptName = resolveName(guildResources.textChannels, value.transcriptChannelId);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      await onSave();
      setMessage("Panel configuration saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save panel config.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    setError(null);
    try {
      await onPublish();
      setMessage("Panel published to Discord.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish panel.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-panel-channel">Panel Channel ID</Label>
          <Input
            id="tp-panel-channel"
            value={value.panelChannelId}
            onChange={(e) => onChange({ ...value, panelChannelId: e.target.value })}
            placeholder="Channel ID where the panel message is posted"
          />
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-category">Ticket Category</Label>
          <select
            id="tp-category"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.categoryChannelId}
            onChange={(e) => onChange({ ...value, categoryChannelId: e.target.value })}
          >
            {value.categoryChannelId && !guildResources.categories.find((c) => c.id === value.categoryChannelId) && (
              <option value={value.categoryChannelId}>{value.categoryChannelId}</option>
            )}
            {guildResources.categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
          {categoryName && categoryName !== value.categoryChannelId && (
            <p className="text-xs text-muted-foreground">Selected: {categoryName}</p>
          )}
        </div>

        <div className="min-w-0 space-y-2">
          <Label htmlFor="tp-transcript">Transcript Channel</Label>
          <select
            id="tp-transcript"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            value={value.transcriptChannelId}
            onChange={(e) => onChange({ ...value, transcriptChannelId: e.target.value })}
          >
            {value.transcriptChannelId && !guildResources.textChannels.find((c) => c.id === value.transcriptChannelId) && (
              <option value={value.transcriptChannelId}>{value.transcriptChannelId}</option>
            )}
            {guildResources.textChannels.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.name}
              </option>
            ))}
          </select>
          {transcriptName && transcriptName !== value.transcriptChannelId && (
            <p className="text-xs text-muted-foreground">Selected: {transcriptName}</p>
          )}
        </div>
      </div>

      {value.ticketTypes.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Ticket Types</p>
          <div className="space-y-2">
            {value.ticketTypes.map((tt) => {
              const supportRoleName = tt.supportRoleId
                ? resolveName(guildResources.roles, tt.supportRoleId)
                : null;
              return (
                <div key={tt.id} className="rounded-md border bg-background p-3 text-sm">
                  <span className="font-medium">{tt.label}</span>
                  {supportRoleName && (
                    <span className="ml-2 text-muted-foreground">— {supportRoleName}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto sm:min-w-[10rem]"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "Saving…" : "Save panel config"}
        </Button>
        <Button
          size="sm"
          className="w-full sm:w-auto sm:min-w-[10rem]"
          disabled={publishing}
          onClick={() => void handlePublish()}
        >
          {publishing ? "Publishing…" : "Publish panel"}
        </Button>
      </div>

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
