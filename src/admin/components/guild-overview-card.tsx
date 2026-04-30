import type { TimedRoleAssignment } from "../../types";
import type { AdminPermissionCheck } from "../../runtime/admin-types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
  permissionChecks: AdminPermissionCheck[];
  roleNamesById: Record<string, string>;
}

export function GuildOverviewCard({
  guild,
  guildName,
}: {
  guild: AdminOverviewGuild;
  guildName: string | null;
}) {
  const heading = guildName ?? guild.guildId;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Guild</p>
          <h3 className="mt-2 text-lg font-semibold tracking-tight">{heading}</h3>
          {guildName ? (
            <p className="mt-1 text-xs text-muted-foreground">{guild.guildId}</p>
          ) : null}
          <p className="mt-1 text-sm text-muted-foreground">
            Stored moderation data for this server.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
            {guild.emojis.length} blocked emoji{guild.emojis.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-md border bg-muted/40 px-3 py-1 text-xs font-medium text-foreground">
            {guild.timedRoles.length} timed role{guild.timedRoles.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div className="rounded-md border bg-muted/30 p-4">
        <p className="text-xs font-medium text-muted-foreground">Blocked Emoji</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Blocked emojis: {guild.emojis.length === 0 ? "None" : guild.emojis.join(" ")}
        </p>
      </div>
      {guild.permissionChecks.length > 0 ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Permission watch</p>
              <div className="mt-2 space-y-1">
                {guild.permissionChecks.map((check) => (
                  <p key={check.label} className="text-sm text-muted-foreground">
                    {check.detail}
                  </p>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {guild.permissionChecks.map((check) => (
                <span
                  key={check.label}
                  className="rounded-md border border-amber-500/30 bg-background/60 px-3 py-1 text-xs font-medium text-amber-100"
                >
                  {check.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {guild.timedRoles.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-background px-4 py-6 text-sm text-muted-foreground">
          No timed roles are active in this guild.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guild.timedRoles.map((assignment) => (
              <TableRow key={`${assignment.guildId}:${assignment.userId}:${assignment.roleId}`}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{assignment.userId}</span>
                </TableCell>
                <TableCell>
                  {guild.roleNamesById[assignment.roleId] ? (
                    <span>
                      {guild.roleNamesById[assignment.roleId]}
                      <span className="ml-1 font-mono text-xs text-muted-foreground">({assignment.roleId})</span>
                    </span>
                  ) : (
                    <span className="font-mono text-xs text-muted-foreground">{assignment.roleId}</span>
                  )}
                </TableCell>
                <TableCell>{assignment.durationInput}</TableCell>
                <TableCell>{new Date(assignment.expiresAtMs).toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
