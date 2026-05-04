import { useEffect, useRef, useState } from "react";

import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { EmojiPicker, type GuildEmojiResource } from "./emoji-picker";
import { NoGuildSelected } from "./no-guild-selected";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { RefreshIcon } from "./ui/icons";

export function AdminBlocklistPage({ selectedGuildId }: { selectedGuildId: string }) {
  const [emoji, setEmoji] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [currentEmojis, setCurrentEmojis] = useState<string[] | null>(null);
  const [notificationChannelId, setNotificationChannelId] = useState("");
  const [textChannels, setTextChannels] = useState<Array<{ id: string; name: string }>>([]);
  const [guildEmojis, setGuildEmojis] = useState<GuildEmojiResource[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedGuildId, setLoadedGuildId] = useState<string>("");
  const trimmedGuildId = selectedGuildId.trim();
  const requestRef = useRef(0);

  async function loadBlocklist(id: string) {
    const normalizedGuildId = id.trim();
    if (!normalizedGuildId) {
      setCurrentEmojis(null);
      setLoadedGuildId("");
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);

    try {
      const [res, resourcesRes] = await Promise.all([
        fetch(`/admin/api/blocklist?guildId=${encodeURIComponent(normalizedGuildId)}`),
        fetch(`/admin/api/tickets/resources?guildId=${encodeURIComponent(normalizedGuildId)}`),
      ]);
      if (requestRef.current !== requestId) return;
      if (res.ok) {
        const data = (await res.json()) as {
          emojis: string[];
          notificationChannelId?: string | null;
        };
        if (requestRef.current !== requestId) return;
        setCurrentEmojis(data.emojis);
        setNotificationChannelId(data.notificationChannelId ?? "");
      } else {
        throw new Error(`Failed to load blocklist (${res.status})`);
      }
      if (resourcesRes.ok) {
        const resources = (await resourcesRes.json()) as {
          textChannels: Array<{ id: string; name: string }>;
          emojis?: GuildEmojiResource[];
        };
        if (requestRef.current !== requestId) return;
        setTextChannels(resources.textChannels);
        setGuildEmojis(resources.emojis ?? []);
      }
      setLoadedGuildId(normalizedGuildId);
    } catch (error) {
      if (requestRef.current !== requestId) return;
      setLoadError(error instanceof Error ? error.message : "Failed to load blocklist.");
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!trimmedGuildId) {
      requestRef.current++;
      setCurrentEmojis(null);
      setLoadedGuildId("");
      setLoadError(null);
      setLoading(false);
      return;
    }
    if (trimmedGuildId === loadedGuildId) return;
    void loadBlocklist(trimmedGuildId);
  }, [trimmedGuildId, loadedGuildId]);

  async function handleSaveNotificationChannel() {
    const res = await fetch("/admin/api/activity-log-channel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: selectedGuildId,
        notificationChannelId: notificationChannelId.trim() || null,
      }),
    });

    if (res.ok) {
      setResult(
        notificationChannelId.trim()
          ? `Saved moderation log channel for ${selectedGuildId}.`
          : `Cleared moderation log channel for ${selectedGuildId}.`,
      );
    }
  }

  async function handleSubmit() {
    const res = await fetch("/admin/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: selectedGuildId, emoji, action }),
    });

    if (res.ok) {
      await loadBlocklist(selectedGuildId);
      setResult(`${action === "add" ? "Blocked" : "Unblocked"} ${emoji} in ${selectedGuildId}`);
    }
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Blocklist"
        description="Load and update blocked reaction emojis for a specific server."
      />

      <PermissionNotice selectedGuildId={selectedGuildId} feature="blocklist" />

      {!trimmedGuildId ? (
        <NoGuildSelected feature="blocklist" />
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            {loadError ? (
              <Alert variant="destructive">
                <AlertDescription>{loadError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {loading
                  ? "Loading blocklist…"
                  : currentEmojis !== null
                    ? "Loaded from Discord."
                    : "Preparing data…"}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                disabled={loading}
                onClick={() => void loadBlocklist(trimmedGuildId)}
              >
                <RefreshIcon className="h-4 w-4" />
                {loading ? "Reloading…" : "Reload"}
              </Button>
            </div>

            <EditorPanel>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(14rem,0.95fr)]">
                <FormField label="Emoji" htmlFor="bl-emoji">
                  <Input
                    id="bl-emoji"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    placeholder="Paste a unicode emoji or pick one below"
                  />
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
              <FormField label="Server emojis">
                <EmojiPicker
                  emojis={guildEmojis}
                  loading={loading && guildEmojis.length === 0}
                  selectedName={emoji.replace(/^:|:$/g, "")}
                  onSelect={(picked) => setEmoji(picked.name)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Click a server emoji to fill the field. Custom emojis are blocked by name (matches
                  Discord reaction names).
                </p>
              </FormField>
              <EditorActions>
                <Button
                  size="sm"
                  className="w-full sm:w-auto sm:min-w-[10rem]"
                  disabled={!emoji.trim()}
                  onClick={() => void handleSubmit()}
                >
                  Apply
                </Button>
              </EditorActions>
            </EditorPanel>

            <EditorPanel>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_auto] md:items-end">
                <FormField label="Moderation log channel (optional)" htmlFor="bl-log-channel">
                  {textChannels.length > 0 ? (
                    <datalist id="bl-log-channel-list">
                      {textChannels.map((channel) => (
                        <option key={channel.id} value={channel.id} label={channel.name} />
                      ))}
                    </datalist>
                  ) : null}
                  <Input
                    id="bl-log-channel"
                    list={textChannels.length > 0 ? "bl-log-channel-list" : undefined}
                    placeholder="123456789012345678"
                    value={notificationChannelId}
                    onChange={(event) => setNotificationChannelId(event.target.value)}
                  />
                </FormField>
              </div>
              <EditorActions>
                <Button
                  size="sm"
                  className="w-full sm:w-auto sm:min-w-[14rem]"
                  variant="outline"
                  onClick={() => void handleSaveNotificationChannel()}
                >
                  Save log channel
                </Button>
              </EditorActions>
            </EditorPanel>

            {currentEmojis !== null ? (
              <div className="rounded-lg border bg-background p-4">
                {currentEmojis.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No emojis currently blocked in this guild.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Currently blocked:</p>
                    <div className="flex flex-wrap gap-2">
                      {currentEmojis.map((entry) => {
                        const match = guildEmojis.find((g) => g.name === entry);
                        return (
                          <span
                            key={entry}
                            className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                          >
                            {match ? (
                              <img
                                src={`https://cdn.discordapp.com/emojis/${match.id}.${match.animated ? "gif" : "png"}?size=32&quality=lossless`}
                                alt={match.name}
                                className="h-4 w-4 object-contain"
                                loading="lazy"
                              />
                            ) : null}
                            <span className="font-mono">{entry}</span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
                <p className="mt-2 text-sm text-muted-foreground">
                  {notificationChannelId.trim()
                    ? `Updates will be posted to channel ${notificationChannelId.trim()}.`
                    : "Updates are not currently posted to a Discord channel."}
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
      )}
    </section>
  );
}
