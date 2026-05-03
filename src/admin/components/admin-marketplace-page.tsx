import { useEffect, useRef, useState } from "react";

import type { MarketplaceBusinessLog, MarketplaceConfig, MarketplacePost } from "../../types";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { NoGuildSelected } from "./no-guild-selected";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

interface MarketplaceResource {
  config: MarketplaceConfig;
  posts: MarketplacePost[];
  logs: MarketplaceBusinessLog[];
}

export function AdminMarketplacePage({ selectedGuildId }: { selectedGuildId: string }) {
  const trimmedGuildId = selectedGuildId.trim();

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Marketplace"
        description="Configure marketplace servers, channels, active listings, and trade logs."
      />
      <PermissionNotice selectedGuildId={selectedGuildId} feature="marketplace" />
      {!trimmedGuildId ? (
        <NoGuildSelected feature="marketplace" />
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <MarketplaceEditor selectedGuildId={trimmedGuildId} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function MarketplaceEditor({ selectedGuildId }: { selectedGuildId: string }) {
  const [resource, setResource] = useState<MarketplaceResource | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  async function loadMarketplace() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/admin/api/marketplace?guildId=${encodeURIComponent(selectedGuildId)}`,
      );
      if (!response.ok) throw new Error("Failed to load marketplace.");
      const data = (await response.json()) as MarketplaceResource;
      if (requestRef.current === requestId) setResource(data);
    } catch (loadError) {
      if (requestRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load marketplace.");
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    void loadMarketplace();
  }, [selectedGuildId]);

  async function saveConfig() {
    if (!resource) return;
    setMessage(null);
    setError(null);
    const response = await fetch("/admin/api/marketplace/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resource.config),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Failed to save marketplace config.");
      return;
    }
    setMessage("Marketplace config saved. Run /marketplace setup to publish the noticeboard.");
    await loadMarketplace();
  }

  async function closePost(post: MarketplacePost) {
    setMessage(null);
    setError(null);
    const response = await fetch("/admin/api/marketplace/post/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: selectedGuildId,
        postId: post.id,
        closedByUserId: "admin-dashboard",
      }),
    });
    if (!response.ok) {
      setError("Failed to close marketplace post.");
      return;
    }
    setMessage(`Closed marketplace post ${post.id}.`);
    await loadMarketplace();
  }

  if (!resource) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading marketplace…" : "Marketplace not loaded."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Noticeboard channel ID" htmlFor="mp-notice-channel">
            <Input
              id="mp-notice-channel"
              value={resource.config.noticeChannelId ?? ""}
              onChange={(event) =>
                updateConfig(resource, setResource, {
                  noticeChannelId: event.target.value.trim() || null,
                })
              }
              placeholder="123456789012345678"
            />
          </FormField>
          <FormField label="Log channel ID" htmlFor="mp-log-channel">
            <Input
              id="mp-log-channel"
              value={resource.config.logChannelId ?? ""}
              onChange={(event) =>
                updateConfig(resource, setResource, {
                  logChannelId: event.target.value.trim() || null,
                })
              }
              placeholder="123456789012345678"
            />
          </FormField>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-foreground">Server choices</p>
          {resource.config.serverOptions.map((server, index) => (
            <div
              key={server.id || index}
              className="grid gap-3 md:grid-cols-[1fr_1.5fr_0.7fr_auto]"
            >
              <Input
                aria-label="Server ID"
                value={server.id}
                onChange={(event) =>
                  updateServer(resource, setResource, index, {
                    id: event.target.value.trim().toLowerCase(),
                  })
                }
                placeholder="namalsk"
              />
              <Input
                aria-label="Server label"
                value={server.label}
                onChange={(event) =>
                  updateServer(resource, setResource, index, { label: event.target.value })
                }
                placeholder="Namalsk"
              />
              <Input
                aria-label="Server emoji"
                value={server.emoji ?? ""}
                onChange={(event) =>
                  updateServer(resource, setResource, index, {
                    emoji: event.target.value.trim() || null,
                  })
                }
                placeholder="🧊"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => removeServer(resource, setResource, index)}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" onClick={() => addServer(resource, setResource)}>
            Add server
          </Button>
        </div>
        <EditorActions>
          <Button size="sm" disabled={loading} onClick={() => void saveConfig()}>
            Save marketplace config
          </Button>
        </EditorActions>
      </EditorPanel>

      <EditorPanel>
        <p className="text-sm text-muted-foreground">
          Publish the noticeboard by running <span className="font-mono">/marketplace setup</span>{" "}
          in the Discord channel.
        </p>
      </EditorPanel>

      <MarketplacePostsTable posts={resource.posts} onClose={closePost} />
      <MarketplaceLogsTable logs={resource.logs} />

      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function MarketplacePostsTable({
  posts,
  onClose,
}: {
  posts: MarketplacePost[];
  onClose: (post: MarketplacePost) => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Server</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => (
          <TableRow key={post.id}>
            <TableCell className="font-mono text-xs">{post.id}</TableCell>
            <TableCell>{post.ownerDisplayName}</TableCell>
            <TableCell>{post.serverLabel}</TableCell>
            <TableCell>{post.active ? "Active" : "Closed"}</TableCell>
            <TableCell>
              <Button
                size="sm"
                variant="outline"
                disabled={!post.active}
                onClick={() => onClose(post)}
              >
                Close
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MarketplaceLogsTable({ logs }: { logs: MarketplaceBusinessLog[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>When</TableHead>
          <TableHead>Buyer</TableHead>
          <TableHead>Post</TableHead>
          <TableHead>DM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell>{new Date(log.timestampMs).toLocaleString()}</TableCell>
            <TableCell>{log.buyerDisplayName}</TableCell>
            <TableCell className="font-mono text-xs">{log.postId}</TableCell>
            <TableCell>{log.dmSent ? "Sent" : "Failed"}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function updateConfig(
  resource: MarketplaceResource,
  setResource: (value: MarketplaceResource) => void,
  patch: Partial<MarketplaceConfig>,
) {
  setResource({ ...resource, config: { ...resource.config, ...patch } });
}

function updateServer(
  resource: MarketplaceResource,
  setResource: (value: MarketplaceResource) => void,
  index: number,
  patch: Partial<MarketplaceConfig["serverOptions"][number]>,
) {
  const serverOptions = resource.config.serverOptions.map((server, serverIndex) =>
    serverIndex === index ? { ...server, ...patch } : server,
  );
  updateConfig(resource, setResource, { serverOptions });
}

function addServer(
  resource: MarketplaceResource,
  setResource: (value: MarketplaceResource) => void,
) {
  updateConfig(resource, setResource, {
    serverOptions: [
      ...resource.config.serverOptions,
      { id: "new-server", label: "New Server", emoji: null },
    ],
  });
}

function removeServer(
  resource: MarketplaceResource,
  setResource: (value: MarketplaceResource) => void,
  index: number,
) {
  updateConfig(resource, setResource, {
    serverOptions: resource.config.serverOptions.filter((_, serverIndex) => serverIndex !== index),
  });
}
