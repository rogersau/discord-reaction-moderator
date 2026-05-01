import { useEffect, useRef, useState } from "react";

import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { NoGuildSelected } from "./no-guild-selected";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { RefreshIcon } from "./ui/icons";
import { Input } from "./ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

interface TimedRoleAssignment {
  guildId: string;
  userId: string;
  roleId: string;
  durationInput: string;
  expiresAtMs: number;
}

interface GuildResources {
  roles: Array<{ id: string; name: string }>;
  textChannels: Array<{ id: string; name: string }>;
}

interface NewMemberRoleConfig {
  guildId: string;
  roleId: string | null;
  durationInput: string | null;
}

export function AdminTimedRolesPage({
  selectedGuildId,
}: {
  selectedGuildId: string;
}) {
  const trimmedGuildId = selectedGuildId.trim();
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Timed Roles"
        description="Load and manage timed role assignments for a specific server."
      />

      <PermissionNotice selectedGuildId={selectedGuildId} feature="timed-roles" />

      {!trimmedGuildId ? (
        <NoGuildSelected feature="timed roles" />
      ) : (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <TimedRolesEditor selectedGuildId={selectedGuildId} />
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function TimedRolesEditor({
  selectedGuildId,
}: {
  selectedGuildId: string;
}) {
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [duration, setDuration] = useState("1h");
  const [assignments, setAssignments] = useState<TimedRoleAssignment[] | null>(null);
  const [notificationChannelId, setNotificationChannelId] = useState("");
  const [newMemberRoleId, setNewMemberRoleId] = useState("");
  const [newMemberDuration, setNewMemberDuration] = useState("1w");
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedGuildId, setLoadedGuildId] = useState<string>("");
  const trimmedGuildId = selectedGuildId.trim();
  const requestRef = useRef(0);

  async function loadAssignments(nextGuildId: string) {
    const nextTrimmedGuildId = nextGuildId.trim();
    setMessage(null);
    setError(null);

    if (!nextTrimmedGuildId) {
      setAssignments(null);
      setGuildResources(null);
      setLoadedGuildId("");
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);

    try {
      const [response, resourcesResponse] = await Promise.all([
        fetch(`/admin/api/timed-roles?guildId=${encodeURIComponent(nextTrimmedGuildId)}`),
        fetch(`/admin/api/tickets/resources?guildId=${encodeURIComponent(nextTrimmedGuildId)}`),
      ]);
      if (requestRef.current !== requestId) return;
      if (!response.ok) {
        setError("Failed to load timed roles.");
        return;
      }

      const data = (await response.json()) as {
        assignments: TimedRoleAssignment[];
        notificationChannelId?: string | null;
        newMemberRoleConfig?: NewMemberRoleConfig;
      };
      if (requestRef.current !== requestId) return;
      setAssignments(data.assignments);
      setNotificationChannelId(data.notificationChannelId ?? "");
      setNewMemberRoleId(data.newMemberRoleConfig?.roleId ?? "");
      setNewMemberDuration(data.newMemberRoleConfig?.durationInput ?? "1w");

      if (resourcesResponse.ok) {
        const resources = (await resourcesResponse.json()) as GuildResources;
        if (requestRef.current !== requestId) return;
        setGuildResources(resources);
      }
      setLoadedGuildId(nextTrimmedGuildId);
    } finally {
      if (requestRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!trimmedGuildId) {
      requestRef.current++;
      setAssignments(null);
      setGuildResources(null);
      setLoadedGuildId("");
      setLoading(false);
      return;
    }
    if (trimmedGuildId === loadedGuildId) return;
    void loadAssignments(trimmedGuildId);
  }, [trimmedGuildId, loadedGuildId]);

  async function handleSaveNotificationChannel() {
    setMessage(null);
    setError(null);

    const response = await fetch("/admin/api/moderation-log-channel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: selectedGuildId,
        notificationChannelId: notificationChannelId.trim() || null,
      }),
    });

    if (!response.ok) {
      setError("Failed to save the moderation log channel.");
      return;
    }

    setMessage(
      notificationChannelId.trim()
        ? `Saved moderation log channel for ${selectedGuildId}.`
        : `Cleared moderation log channel for ${selectedGuildId}.`
    );
  }

  async function handleSaveNewMemberConfig(nextRoleId = newMemberRoleId) {
    setMessage(null);
    setError(null);

    const trimmedRoleId = nextRoleId.trim();
    const response = await fetch("/admin/api/timed-roles/new-member-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: selectedGuildId,
        roleId: trimmedRoleId || null,
        duration: trimmedRoleId ? newMemberDuration.trim() : null,
      }),
    });

    const data = (await response.json()) as {
      newMemberRoleConfig?: NewMemberRoleConfig;
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? "Failed to save the new member timed role.");
      return;
    }

    setNewMemberRoleId(data.newMemberRoleConfig?.roleId ?? "");
    setNewMemberDuration(data.newMemberRoleConfig?.durationInput ?? "1w");
    setMessage(
      data.newMemberRoleConfig?.roleId
        ? `New members will receive ${data.newMemberRoleConfig.roleId} for ${data.newMemberRoleConfig.durationInput}.`
        : "New member timed role automation is disabled."
    );
  }

  async function handleAdd() {
    setMessage(null);
    setError(null);

    const response = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        guildId: selectedGuildId,
        userId,
        roleId,
        duration,
      }),
    });

    const data = (await response.json()) as {
      assignments?: TimedRoleAssignment[];
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? "Failed to add the timed role.");
      return;
    }

    setAssignments(data.assignments ?? []);
    setMessage(`Assigned ${roleId} to ${userId} for ${duration}.`);
  }

  async function handleRemove(assignment: TimedRoleAssignment) {
    setMessage(null);
    setError(null);

    const response = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "remove",
        guildId: assignment.guildId,
        userId: assignment.userId,
        roleId: assignment.roleId,
      }),
    });

    const data = (await response.json()) as {
      assignments?: TimedRoleAssignment[];
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? "Failed to remove the timed role.");
      return;
    }

    setAssignments(data.assignments ?? []);
    setMessage(`Removed ${assignment.roleId} from ${assignment.userId}.`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {loading
            ? "Loading timed roles…"
            : assignments !== null
              ? "Loaded from Discord."
              : "Preparing data…"}
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={loading}
          onClick={() => void loadAssignments(selectedGuildId)}
        >
          <RefreshIcon className="h-4 w-4" />
          {loading ? "Reloading…" : "Reload"}
        </Button>
      </div>
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.8fr)]">
          <FormField label="User ID" htmlFor="tr-user">
            <Input id="tr-user" value={userId} onChange={(event) => setUserId(event.target.value)} />
          </FormField>
          <FormField label="Role" htmlFor="tr-role">
            {guildResources ? (
              <datalist id="tr-role-list">
                {guildResources.roles.map((role) => (
                  <option key={role.id} value={role.id} label={role.name} />
                ))}
              </datalist>
            ) : null}
            <Input
              id="tr-role"
              list={guildResources ? "tr-role-list" : undefined}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            />
          </FormField>
          <FormField label="Duration" htmlFor="tr-duration">
            <Input
              id="tr-duration"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
            />
          </FormField>
        </div>
        <EditorActions>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[12rem]"
            disabled={!trimmedGuildId || !userId.trim() || !roleId.trim()}
            onClick={() => void handleAdd()}
          >
            Add timed role
          </Button>
        </EditorActions>
      </EditorPanel>

      <EditorPanel>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">New member temporary role</p>
          <p className="text-xs text-muted-foreground">
            Give members a role when they join, then remove it automatically after the duration.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Newbie role" htmlFor="tr-new-member-role">
            {guildResources ? (
              <datalist id="tr-new-member-role-list">
                {guildResources.roles.map((role) => (
                  <option key={role.id} value={role.id} label={role.name} />
                ))}
              </datalist>
            ) : null}
            <Input
              id="tr-new-member-role"
              list={guildResources ? "tr-new-member-role-list" : undefined}
              placeholder="123456789012345678"
              value={newMemberRoleId}
              onChange={(event) => setNewMemberRoleId(event.target.value)}
            />
          </FormField>
          <FormField label="Keep role for" htmlFor="tr-new-member-duration">
            <Input
              id="tr-new-member-duration"
              placeholder="1h, 1w, or 1m"
              value={newMemberDuration}
              onChange={(event) => setNewMemberDuration(event.target.value)}
            />
          </FormField>
        </div>
        <EditorActions>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            variant="outline"
            disabled={!trimmedGuildId}
            onClick={() => void handleSaveNewMemberConfig()}
          >
            Save new member role
          </Button>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            variant="ghost"
            disabled={!trimmedGuildId}
            onClick={() => {
              setNewMemberRoleId("");
              void handleSaveNewMemberConfig("");
            }}
          >
            Disable new member role
          </Button>
        </EditorActions>
      </EditorPanel>

      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_auto] md:items-end">
          <FormField label="Moderation log channel (optional)" htmlFor="tr-log-channel">
            {guildResources ? (
              <datalist id="tr-log-channel-list">
                {guildResources.textChannels.map((channel) => (
                  <option key={channel.id} value={channel.id} label={channel.name} />
                ))}
              </datalist>
            ) : null}
            <Input
              id="tr-log-channel"
              list={guildResources ? "tr-log-channel-list" : undefined}
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
            disabled={!trimmedGuildId}
            onClick={() => void handleSaveNotificationChannel()}
          >
            Save log channel
          </Button>
        </EditorActions>
      </EditorPanel>

      {assignments !== null ? (
        assignments.length === 0 ? (
          <EmptyState message="No timed roles are active in this guild." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={`${assignment.guildId}:${assignment.userId}:${assignment.roleId}`}>
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">{assignment.userId}</span>
                  </TableCell>
                  <TableCell>
                    {guildResources?.roles.find((r) => r.id === assignment.roleId)?.name ? (
                      <span>
                        {guildResources.roles.find((r) => r.id === assignment.roleId)!.name}
                        <span className="ml-1 font-mono text-xs text-muted-foreground">({assignment.roleId})</span>
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-muted-foreground">{assignment.roleId}</span>
                    )}
                  </TableCell>
                  <TableCell>{assignment.durationInput}</TableCell>
                  <TableCell>{new Date(assignment.expiresAtMs).toLocaleString()}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRemove(assignment)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      {trimmedGuildId && assignments !== null ? (
        <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
          {notificationChannelId.trim()
            ? `Updates will be posted to channel ${notificationChannelId.trim()}.`
            : "Updates are not currently posted to a Discord channel."}
        </div>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
      {message}
    </div>
  );
}
