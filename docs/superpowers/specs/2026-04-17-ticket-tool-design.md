# Ticket tool design

## Problem

This project already manages Discord automation through a shared runtime, a protected admin web interface, and a signed `/interactions` endpoint. The requested addition is a ticketing system where operators configure ticket buttons, roles, and intake questions in the web UI, while ticket creation, closure, and transcript capture happen inside Discord.

## Current context

- The admin UI already persists guild-scoped configuration through session-protected `/admin/api/*` routes.
- The runtime store already holds long-lived guild state for blocklists and timed roles.
- The Discord interaction handler already verifies signed requests and routes slash command behavior.
- The current admin workflow still exposes raw guild and role IDs in several places; the ticket design should improve that by showing human-readable Discord names in the UI while storing immutable IDs internally.

## Scope

This design adds a first-pass ticket system with these responsibilities:

1. Configure one ticket panel per guild in the admin UI
2. Support multiple ticket-type buttons on that panel
3. Let each ticket type define a support role and up to five modal questions
4. Create ticket channels under one shared category per panel
5. Allow the opener or the configured support role to close tickets from Discord
6. Save a transcript to a configured Discord log channel before deleting the ticket channel

Out of scope:

- Multi-panel support in the first version
- Reopen flows after a ticket has been closed and deleted
- Full live-ticket management from the web UI
- External transcript storage outside Discord
- Free-form conversational intake instead of modal-based questions

## Options considered

### 1. Config-driven ticket panel with Discord-managed lifecycle

Use the admin UI to manage panel and ticket-type configuration, then let Discord buttons and modal submissions drive the live lifecycle.

**Pros**

- Matches the requested split between web configuration and Discord operations
- Fits the current architecture cleanly
- Keeps the operator workflow centralized without duplicating day-to-day ticket actions in the web UI

**Cons**

- Requires the interaction layer to support message components and modal submissions, not just slash commands

### 2. Admin-managed ticketing with Discord as a thin client

Keep the same persisted config, but also add live ticket browsing and closure controls in the admin dashboard.

**Pros**

- Gives operators a second place to inspect ticket state

**Cons**

- Duplicates lifecycle controls the user wants in Discord
- Adds more UI and runtime complexity than needed

### 3. Discord-first ticket setup with minimal web configuration

Use slash commands for ticket-type setup and reserve the web UI for only a few defaults.

**Pros**

- Smaller initial build

**Cons**

- Does not satisfy the requirement that buttons, roles, and questions be created from the web interface

## Selected approach

Use option 1: a config-driven ticket panel in the admin UI with a Discord-managed lifecycle.

## Architecture

### Persisted configuration

Add ticketing data to the shared runtime store with three logical layers:

1. **Ticket panel config**: guild ID, shared target category ID, transcript log channel ID, published panel channel/message references, and an ordered list of ticket types
2. **Ticket type config**: stable internal ID, button label, optional emoji, button style, support role ID, optional channel-name prefix, and up to five modal questions
3. **Ticket instance state**: guild ID, ticket type ID, opener user ID, ticket channel ID, open/closed status, submitted answers, and key audit timestamps

Long-lived setup belongs in the panel and ticket-type config. Short-lived operational state belongs in the ticket instance rows needed to enforce lifecycle rules and generate transcripts.

### Admin UI

The admin UI should gain a new ticketing section that:

- selects a guild
- loads Discord metadata for that guild
- presents human-readable pickers for roles, categories, and transcript channels
- edits ticket types with button presentation and modal questions
- publishes or refreshes the ticket panel message in Discord

The user-facing UI should show Discord display names, not raw snowflake IDs. IDs remain the stored source of truth and the value sent back to the runtime, but they should stay hidden from operators unless needed for debugging.

### Discord interaction handling

The interaction layer should expand beyond slash commands to handle:

- ticket panel button clicks
- modal submissions for ticket intake
- close-ticket button presses inside ticket channels

The flow is:

1. User clicks a configured ticket button on the published panel message
2. Bot returns a Discord modal based on that ticket type's question list
3. User submits the modal
4. Bot creates a private ticket channel under the panel's shared category with permissions for the opener, the configured support role, and the bot
5. Bot posts an opening message containing ticket metadata, the submitted answers, and a Close Ticket control
6. Opener or support-role member closes the ticket from Discord
7. Bot generates and posts the transcript to the configured log channel
8. Bot deletes the ticket channel only after transcript persistence succeeds

## Runtime flow

### Admin configuration

1. Operator selects a guild in the web UI
2. Runtime fetches Discord metadata for roles and channels
3. Operator edits ticket types and panel settings using human-readable names
4. Admin API validates the configuration and stores immutable IDs plus presentation fields

### Panel publish

1. Operator publishes or refreshes the panel
2. Runtime validates that the configured role, category, and transcript channel still exist
3. Bot creates or updates the target Discord message with one button per ticket type
4. Stored panel state records the published message reference for future refreshes

### Ticket open

1. User clicks a ticket-type button
2. Runtime validates the panel and ticket type
3. Bot shows the configured modal
4. Modal submission creates the ticket instance row and Discord channel
5. Bot posts the structured opening message and close control in that channel

### Ticket close

1. Opener or support-role member clicks Close Ticket
2. Runtime validates the actor against the stored opener and support role
3. Bot fetches the ticket channel message history
4. Runtime renders a transcript and posts it to the configured Discord log channel as a file attachment
5. Ticket instance is marked closed
6. Bot deletes the ticket channel

## Validation and error handling

### Admin validation

- Reject incomplete panel settings
- Reject ticket types with missing support roles
- Reject more than five modal questions per ticket type
- Reject duplicate ticket-type IDs or duplicate button custom IDs within a panel
- Reject publish attempts when required Discord targets no longer exist

### Runtime interaction failures

- If a user clicks a stale or invalid ticket button, respond with a clear ephemeral error
- If the modal submission can no longer resolve the configured role/category, do not create a channel; return a clear failure message
- If ticket channel creation fails, do not leave a half-created ticket instance marked open
- If transcript generation or transcript posting fails, keep the ticket channel open and surface an in-channel error so staff can retry
- Never delete the ticket channel before transcript persistence succeeds

## Transcript format

Post transcripts to the configured Discord log channel as a file attachment. The transcript should include:

- guild identifier
- ticket type label
- opener display name and ID
- created-at and closed-at timestamps
- closed-by display name and ID
- submitted modal answers
- chronological message history with timestamps and author display names

This keeps the archive readable for moderators while preserving immutable IDs for auditing.

## Permissions

- Ticket channels are private to the bot, the opener, and the configured support role
- The close action is only honored for the opener or members of the configured support role
- The admin UI is still the only supported place to create or change panel configuration
- Discord remains the supported place to open and close tickets in day-to-day use

## Verification

Implementation should verify:

1. Admin config parsing and persistence for panel settings, ticket types, and modal questions
2. Admin UI metadata loading so the surface shows Discord names while storing IDs
3. Discord interaction routing for buttons, modals, and close actions
4. Ticket lifecycle behavior including permission overwrites, transcript generation, and deletion ordering
5. Error paths for stale Discord objects and failed transcript delivery
