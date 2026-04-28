import { useState } from "react";

import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { PermissionNotice } from "./permission-notice";
import { Alert, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
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

export function AdminTimedRolesPage({
  selectedGuildId,
}: {
  selectedGuildId: string;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Timed Roles"
        description="Load and manage timed role assignments for a specific server."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <PermissionNotice selectedGuildId={selectedGuildId} feature="timed-roles" />
          <TimedRolesEditor selectedGuildId={selectedGuildId} />
        </CardContent>
      </Card>
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmedGuildId = selectedGuildId.trim();

  async function loadAssignments(nextGuildId: string) {
    const nextTrimmedGuildId = nextGuildId.trim();
    setMessage(null);
    setError(null);

    if (!nextTrimmedGuildId) {
      setAssignments(null);
      return;
    }

    const response = await fetch(
      `/admin/api/timed-roles?guildId=${encodeURIComponent(nextTrimmedGuildId)}`
    );
    if (!response.ok) {
      setError("Failed to load timed roles.");
      return;
    }

    const data = (await response.json()) as {
      assignments: TimedRoleAssignment[];
      notificationChannelId?: string | null;
    };
    setAssignments(data.assignments);
    setNotificationChannelId(data.notificationChannelId ?? "");
  }

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
      {!trimmedGuildId ? (
        <EmptyState message="Select a server from the sidebar to manage timed roles." />
      ) : null}
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.8fr)]">
          <FormField label="User ID" htmlFor="tr-user">
            <Input id="tr-user" value={userId} onChange={(event) => setUserId(event.target.value)} />
          </FormField>
          <FormField label="Role ID" htmlFor="tr-role">
            <Input id="tr-role" value={roleId} onChange={(event) => setRoleId(event.target.value)} />
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
            variant="outline"
            disabled={!trimmedGuildId}
            onClick={() => void loadAssignments(selectedGuildId)}
          >
            Load timed roles
          </Button>
          <Button
            size="sm"
            className="w-full sm:w-auto sm:min-w-[12rem]"
            disabled={!trimmedGuildId}
            onClick={() => void handleAdd()}
          >
            Add timed role
          </Button>
        </EditorActions>
      </EditorPanel>

      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_auto] md:items-end">
          <FormField label="Moderation log channel ID (optional)" htmlFor="tr-log-channel">
            <Input
              id="tr-log-channel"
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
                  <TableCell>{assignment.userId}</TableCell>
                  <TableCell>{assignment.roleId}</TableCell>
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
