import { useEffect, useRef, useState } from "react";

import type { LfgConfig, LfgPost } from "../../types";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { NoGuildSelected } from "./no-guild-selected";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

interface LfgResource {
  config: LfgConfig;
  posts: LfgPost[];
}

export function AdminLfgPage({ selectedGuildId }: { selectedGuildId: string }) {
  const trimmedGuildId = selectedGuildId.trim();

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="LFG"
        description="Configure LFG servers and manage active posts."
      />
      <PermissionNotice selectedGuildId={selectedGuildId} feature="lfg" />
      {!trimmedGuildId ? (
        <NoGuildSelected feature="LFG" />
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <LfgEditor selectedGuildId={trimmedGuildId} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function LfgEditor({ selectedGuildId }: { selectedGuildId: string }) {
  const [resource, setResource] = useState<LfgResource | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  async function loadLfg() {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/admin/api/lfg?guildId=${encodeURIComponent(selectedGuildId)}`,
      );
      if (!response.ok) throw new Error("Failed to load LFG.");
      const data = (await response.json()) as LfgResource;
      if (requestRef.current === requestId) setResource(data);
    } catch (loadError) {
      if (requestRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load LFG.");
      }
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    void loadLfg();
  }, [selectedGuildId]);

  async function saveConfig() {
    if (!resource) return;
    setMessage(null);
    setError(null);
    const response = await fetch("/admin/api/lfg/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resource.config),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      setError(data.error ?? "Failed to save LFG config.");
      return;
    }
    setMessage("LFG config saved. Run /lfg setup to publish the noticeboard.");
    await loadLfg();
  }

  async function closePost(post: LfgPost) {
    setMessage(null);
    setError(null);
    const response = await fetch("/admin/api/lfg/post/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: selectedGuildId,
        postId: post.id,
        closedByUserId: "admin-dashboard",
      }),
    });
    if (!response.ok) {
      setError("Failed to close LFG post.");
      return;
    }
    setMessage(`Closed LFG post ${post.id}.`);
    await loadLfg();
  }

  if (!resource) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Loading LFG…" : "LFG not loaded."}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Noticeboard channel ID" htmlFor="lfg-notice-channel">
            <Input
              id="lfg-notice-channel"
              value={resource.config.noticeChannelId ?? ""}
              onChange={(event) =>
                updateConfig(resource, setResource, {
                  noticeChannelId: event.target.value.trim() || null,
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
            Save LFG config
          </Button>
        </EditorActions>
      </EditorPanel>

      <EditorPanel>
        <p className="text-sm text-muted-foreground">
          Publish the noticeboard by running <span className="font-mono">/lfg setup</span>{" "}
          in the Discord channel.
        </p>
      </EditorPanel>

      <LfgPostsTable posts={resource.posts} onClose={closePost} />

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

function LfgPostsTable({ posts, onClose }: { posts: LfgPost[]; onClose: (post: LfgPost) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Server</TableHead>
          <TableHead>When</TableHead>
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
            <TableCell>{post.whenPlay}</TableCell>
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

function updateConfig(
  resource: LfgResource,
  setResource: (value: LfgResource) => void,
  patch: Partial<LfgConfig>,
) {
  setResource({ ...resource, config: { ...resource.config, ...patch } });
}

function updateServer(
  resource: LfgResource,
  setResource: (value: LfgResource) => void,
  index: number,
  patch: Partial<LfgConfig["serverOptions"][number]>,
) {
  const serverOptions = resource.config.serverOptions.map((server, serverIndex) =>
    serverIndex === index ? { ...server, ...patch } : server,
  );
  updateConfig(resource, setResource, { serverOptions });
}

function addServer(resource: LfgResource, setResource: (value: LfgResource) => void) {
  updateConfig(resource, setResource, {
    serverOptions: [
      ...resource.config.serverOptions,
      { id: "new-server", label: "New Server", emoji: null },
    ],
  });
}

function removeServer(
  resource: LfgResource,
  setResource: (value: LfgResource) => void,
  index: number,
) {
  updateConfig(resource, setResource, {
    serverOptions: resource.config.serverOptions.filter((_, serverIndex) => serverIndex !== index),
  });
}
