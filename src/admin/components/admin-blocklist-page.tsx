import { useState } from "react";

import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { GuildPicker } from "./guild-picker";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";

export function AdminBlocklistPage({
  guildDirectory,
  guildLookupError,
  onUpdated,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
  onUpdated: () => Promise<void>;
}) {
  const [guildId, setGuildId] = useState("");
  const [emoji, setEmoji] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [currentEmojis, setCurrentEmojis] = useState<string[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const trimmedGuildId = guildId.trim();

  async function loadBlocklist(id: string) {
    const normalizedGuildId = id.trim();
    if (!normalizedGuildId) {
      setCurrentEmojis(null);
      return;
    }

    try {
      const res = await fetch(`/admin/api/blocklist?guildId=${encodeURIComponent(normalizedGuildId)}`);
      if (res.ok) {
        const data = await res.json() as { emojis: string[] };
        setCurrentEmojis(data.emojis);
      }
    } catch (error) {
      console.error(error);
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
    <section className="space-y-6">
      <AdminPageHeader
        title="Blocklist"
        description="Load and update blocked reaction emojis for a specific server."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <EditorPanel>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(14rem,0.95fr)]">
              <GuildPicker
                id="bl-guild"
                value={guildId}
                guildDirectory={guildDirectory}
                loadError={guildLookupError}
                onChange={(nextGuildId) => {
                  setGuildId(nextGuildId);
                  setCurrentEmojis(null);
                }}
              />
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
              <Button size="sm" className="w-full sm:w-auto sm:min-w-[10rem]" onClick={() => void handleSubmit()}>
                Apply
              </Button>
            </EditorActions>
          </EditorPanel>

          {currentEmojis !== null ? (
            <div className="rounded-lg border bg-background p-4">
              <p className="text-sm text-muted-foreground">
                {currentEmojis.length === 0
                  ? "No emojis currently blocked in this guild."
                  : `Currently blocked: ${currentEmojis.join(" ")}`}
              </p>
            </div>
          ) : null}

          {result ? (
            <Alert>
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
