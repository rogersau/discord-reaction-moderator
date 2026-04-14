# Timed Roles Design

## Problem

The bot needs a new `/timedrole` slash command so guild admins can temporarily assign a pre-configured Discord role to a member for a fixed duration such as `1h`, `1w`, or `1m`. The role itself is managed in Discord and is expected to remove message-posting access while still allowing ticket creation. Timed-role expiries must survive deploys and restarts.

## Goals

- Add a guild-only `/timedrole user:<member> role:<role> duration:<text>` slash command.
- Restrict usage to members with Administrator or Manage Guild permissions.
- Add the requested Discord role immediately when the command succeeds.
- Persist timed-role assignments so expiry still happens after restarts or deploys.
- Replace an existing active timed-role assignment for the same guild, user, and role when the command is run again.
- Remove expired roles automatically.

## Non-Goals

- Managing channel permission overwrites or ticket-system permissions.
- Creating or configuring the Discord role itself.
- Supporting arbitrary duration syntax beyond the requested `h`, `w`, and `m` units.

## Recommended Architecture

Use the existing worker as the slash-command entrypoint and extend `ModerationStoreDO` to store timed-role assignments.

### Worker

- Extend `SLASH_COMMAND_DEFINITIONS` with a top-level `timedrole` command.
- Parse the application command payload and validate:
  - guild context exists
  - invoker has Administrator or Manage Guild permissions
  - `user`, `role`, and `duration` options are present
  - duration format is valid
- Call `ModerationStoreDO` to upsert the timed-role assignment.
- Call the Discord REST API to add the role to the member.
- Return explicit ephemeral success or failure messages.

### ModerationStoreDO

Add a `timed_roles` table with one row per active guild/user/role assignment:

- `guild_id TEXT NOT NULL`
- `user_id TEXT NOT NULL`
- `role_id TEXT NOT NULL`
- `duration_input TEXT NOT NULL`
- `expires_at_ms INTEGER NOT NULL`
- `created_at_ms INTEGER NOT NULL`
- `updated_at_ms INTEGER NOT NULL`
- `PRIMARY KEY (guild_id, user_id, role_id)`

Add timed-role endpoints/helpers for:

- upserting an assignment
- reading the next pending expiry
- listing expired assignments
- deleting assignments after successful expiry processing

`ModerationStoreDO` should use a Durable Object alarm. After every upsert or expiry pass, it should schedule the next alarm for the earliest `expires_at_ms` still in storage.

## Command Behavior

`/timedrole` acts as an upsert for the exact guild + user + role combination.

- If no active assignment exists, create one.
- If one already exists, replace its expiry with the newly requested duration.
- Success response example: `Assigned @Muted to @User for 1w.`
- Include an expiry hint in the response when available.

Duration parsing rules:

- `1h` = one hour
- `1w` = one week
- `1m` = one month

The command should reject malformed durations before touching storage.

## Expiry Flow

### On command execution

1. Validate the Discord interaction and parse the command.
2. Parse the duration into `expires_at_ms`.
3. Upsert the timed-role row in `ModerationStoreDO`.
4. Add the Discord role to the member through the Discord API.
5. If the role add fails, immediately delete the just-upserted row before returning the failure response.
6. Return an ephemeral confirmation message on success.

### On expiry

1. `ModerationStoreDO` alarm fires at the next known expiry.
2. The DO selects all rows with `expires_at_ms <= now`.
3. For each expired row, remove the role through the Discord API.
4. Delete only the rows whose Discord role removal succeeded.
5. Keep failed removals in storage so the next alarm retries them.
6. Re-arm the alarm for the next soonest expiry still stored.

## Error Handling

- Invalid duration input returns an ephemeral validation error.
- Unsupported command payloads return an ephemeral unsupported-command response.
- Missing guild context returns the existing guild-only command error.
- Discord role-add failures return an explicit ephemeral failure response and roll back the just-created assignment row.
- Discord role-remove failures during expiry are logged and retried by keeping the row.
- Duplicate invocations are handled deterministically by replacing the existing expiry.

## Testing

Add or extend tests for:

- slash command definitions including the new `timedrole` command
- interaction parsing for `user`, `role`, and `duration`
- duration parsing and invalid-input rejection
- permission enforcement for the new command
- duplicate replacement behavior
- worker/store integration for successful timed-role assignment
- `ModerationStoreDO` timed-role upsert and expiry queries
- alarm scheduling and re-scheduling behavior
- Discord API helper calls for adding and removing member roles

## Open Decisions Resolved

- The bot only assigns and removes the chosen role. Discord role and channel permissions are pre-configured outside the bot.
- Expiries must persist across restarts and deploys.
- Re-running `/timedrole` for the same user and role replaces the existing expiry.
- `m` means month for this feature.
