import { useState } from "react";

import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";
import { AdminPageHeader } from "./admin-page-header";
import { EditorActions, EditorPanel, FormField } from "./admin-form-layout";
import { GuildPicker } from "./guild-picker";
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
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Timed Roles"
        description="Load and manage timed role assignments for a specific server."
      />

      <Card>
        <CardContent className="space-y-5 pt-6">
          <PermissionNotice
            description="Timed role changes can fail if the bot cannot manage roles or if its highest role is below the target role."
            checks={["Manage Roles", "Highest role above target"]}
          />
          <TimedRolesEditor
            guildDirectory={guildDirectory}
            guildLookupError={guildLookupError}
          />
        </CardContent>
      </Card>
    </section>
  );
}

function TimedRolesEditor({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  const [guildId, setGuildId] = useState("");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [duration, setDuration] = useState("1h");
  const [assignments, setAssignments] = useState<TimedRoleAssignment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const trimmedGuildId = guildId.trim();

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

    const data = (await response.json()) as { assignments: TimedRoleAssignment[] };
    setAssignments(data.assignments);
  }

  async function handleAdd() {
    setMessage(null);
    setError(null);

    const response = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "add",
        guildId,
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
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.8fr)]">
          <GuildPicker
            id="tr-guild"
            value={guildId}
            guildDirectory={guildDirectory}
            loadError={guildLookupError}
            onChange={(nextGuildId) => {
              setGuildId(nextGuildId);
              setAssignments(null);
            }}
          />
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
            onClick={() => void loadAssignments(guildId)}
          >
            Load timed roles
          </Button>
          <Button size="sm" className="w-full sm:w-auto sm:min-w-[12rem]" onClick={() => void handleAdd()}>
            Add timed role
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
