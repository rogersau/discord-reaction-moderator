# Server name admin UI design

## Problem

The admin dashboard currently makes operators enter and read raw Discord `guildId` values in the blocklist, timed roles, ticket panel, and overview surfaces. The requested change is to make the dashboard work in terms of recognizable server names instead, while keeping the existing runtime and storage model stable.

## Current context

- The admin UI lives in `src/admin/App.tsx`.
- The user-facing guild selection points are the blocklist, timed roles, and ticket panel editors.
- The overview surface currently renders stored guilds by `guildId`.
- Runtime routes under `/admin/api/*` and the underlying store contract still accept and return `guildId`.
- Discord-facing runtime operations already need `guildId`, so replacing IDs as the true identifier would ripple through storage, Discord API calls, and tests.

## Options considered

### 1. Add a shared server picker and keep `guildId` internal

Fetch the bot's visible guild list for the admin UI, show server names in a shared picker, and continue submitting `guildId` to every existing route.

**Pros**
- Removes manual ID entry from the main admin workflow
- Preserves current storage and Discord API behavior
- Keeps the change concentrated in the admin UI and authenticated admin routes
- Gives a clean way to handle duplicate server names

**Cons**
- Needs one new admin API route plus client-side mapping logic
- Still needs an explicit fallback when the guild directory cannot be loaded

### 2. Resolve typed server names to IDs only on submit

Keep the existing text inputs but let operators type a server name, then resolve that name to a `guildId` when loading or saving.

**Pros**
- Smaller UI refactor
- Reuses most of the current form layout

**Cons**
- Ambiguous when multiple guilds share the same name
- Harder to give clear feedback for typos and partial matches
- Makes error handling more awkward than a picker-driven flow

### 3. Show server names in overview only

Leave the inputs as raw IDs and only improve display labels where the UI renders existing guilds.

**Pros**
- Smallest implementation

**Cons**
- Does not solve the core pain point of entering and working from server names

## Selected approach

Use option 1: add a shared, searchable server picker in the admin UI and keep `guildId` as the internal identifier everywhere else.

This directly addresses the operator experience without destabilizing the runtime contract. The UI becomes friendlier, but the backend remains aligned with Discord's actual identifiers.

## Scope

In scope:

- A new authenticated admin API route that exposes the bot's guild directory for UI use
- Admin UI updates so the three guild-selection workflows use server names instead of raw ID entry
- Overview label updates so stored guilds display server names when available
- Duplicate-name handling and a safe fallback path when live guild lookup fails
- Tests for the new route and UI behavior

Out of scope:

- Replacing `guildId` in Durable Object storage, runtime contracts, or Discord API calls
- Migrating stored data from IDs to names
- Introducing fuzzy cross-guild search beyond what the picker needs
- Changing slash command behavior or non-admin flows

## Design

### Backend route

Add a new authenticated route such as `GET /admin/api/guilds`.

The route returns a normalized list shaped for the UI:

```json
{
  "guilds": [
    {
      "guildId": "123",
      "name": "My Server",
      "label": "My Server"
    }
  ]
}
```

The route fetches the bot's visible guild list from Discord, sorts entries by name, and computes `label` values for display. If duplicate names exist, `label` includes the `guildId`, for example `My Server (123)`, so the picker stays unambiguous.

### Admin UI structure

- Fetch the guild directory once near the top-level `App` component after authentication.
- Introduce a reusable picker component for guild selection so blocklist, timed roles, and ticket panels all use the same behavior.
- Keep local editor state based on the selected `guildId`, not the displayed name.
- Update the overview card header to show the server name as the primary label and the `guildId` as secondary metadata when the live guild directory contains a match.

### Data flow

1. The dashboard loads overview data and the guild directory in parallel.
2. The picker displays server names and stores the selected `guildId` in editor state.
3. Existing admin routes continue to receive `guildId` query params and JSON bodies unchanged.
4. Stored overview guilds merge with the live guild directory by `guildId` for display labeling only.
5. If a stored guild no longer appears in the live guild directory, the UI falls back to showing its raw ID.

### Error handling

- If the guild directory request fails, show an inline admin-facing error.
- When guild lookup is unavailable, fall back to the existing manual `guildId` input so operations remain possible.
- Do not silently guess a guild when names collide; duplicate names must stay explicitly disambiguated in the picker label.
- If a saved or stored `guildId` is not present in the fetched list, keep using the ID rather than blocking the screen.

### Testing

Add coverage for:

- the new guild-directory admin route
- duplicate-name label generation
- blocklist, timed roles, and ticket panel selection through the shared server picker
- fallback to manual `guildId` entry when guild-directory loading fails
- overview rendering that prefers server names and falls back to IDs

## Verification

- Confirm the admin bundle still builds after the UI refactor.
- Confirm the existing repository test and typecheck commands still pass after implementation.
