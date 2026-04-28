import type { TimedRoleAssignment, TimedRoleRow } from "../../types";

export function upsertTimedRole(
  sql: DurableObjectStorage["sql"],
  body: TimedRoleAssignment
): void {
  const now = Date.now();
  sql.exec(
    "INSERT INTO timed_roles(guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id, role_id) DO UPDATE SET duration_input = excluded.duration_input, expires_at_ms = excluded.expires_at_ms, updated_at_ms = excluded.updated_at_ms",
    body.guildId,
    body.userId,
    body.roleId,
    body.durationInput,
    body.expiresAtMs,
    now,
    now
  );
}

export function deleteTimedRole(
  sql: DurableObjectStorage["sql"],
  body: { guildId: string; userId: string; roleId: string }
): void {
  sql.exec(
    "DELETE FROM timed_roles WHERE guild_id = ? AND user_id = ? AND role_id = ?",
    body.guildId,
    body.userId,
    body.roleId
  );
}

export function listTimedRolesByGuild(
  sql: DurableObjectStorage["sql"],
  guildId: string
): TimedRoleAssignment[] {
  return readTimedRoleSelections(
    sql,
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE guild_id = ? ORDER BY expires_at_ms ASC",
    guildId
  );
}

export function listTimedRoles(sql: DurableObjectStorage["sql"]): TimedRoleAssignment[] {
  return readTimedRoleSelections(
    sql,
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles ORDER BY guild_id ASC, expires_at_ms ASC"
  );
}

export function listExpiredTimedRoles(
  sql: DurableObjectStorage["sql"],
  currentTimeMs: number
): TimedRoleAssignment[] {
  return readTimedRoleSelections(
    sql,
    "SELECT guild_id, user_id, role_id, duration_input, expires_at_ms, created_at_ms, updated_at_ms FROM timed_roles WHERE expires_at_ms <= ? ORDER BY expires_at_ms ASC",
    currentTimeMs
  );
}

export function getNextTimedRoleExpiryMs(sql: DurableObjectStorage["sql"]): number | null {
  const nextRow = [
    ...sql.exec(
      "SELECT expires_at_ms FROM timed_roles ORDER BY expires_at_ms ASC LIMIT 1"
    ),
  ][0];

  if (!nextRow) {
    return null;
  }

  return nextRow.expires_at_ms as number;
}

function readTimedRoleSelections(
  sql: DurableObjectStorage["sql"],
  query: string,
  ...params: unknown[]
): TimedRoleAssignment[] {
  const rows: TimedRoleRow[] = [...sql.exec(query, ...params)].map(
    mapTimedRoleRow
  );
  return rows.map(mapTimedRoleAssignment);
}

function mapTimedRoleRow(row: Record<string, unknown>): TimedRoleRow {
  return {
    guild_id: row.guild_id as string,
    user_id: row.user_id as string,
    role_id: row.role_id as string,
    duration_input: row.duration_input as string,
    expires_at_ms: row.expires_at_ms as number,
    created_at_ms: row.created_at_ms as number,
    updated_at_ms: row.updated_at_ms as number,
  };
}

function mapTimedRoleAssignment(row: TimedRoleRow): TimedRoleAssignment {
  return {
    guildId: row.guild_id,
    userId: row.user_id,
    roleId: row.role_id,
    durationInput: row.duration_input,
    expiresAtMs: row.expires_at_ms,
  };
}
