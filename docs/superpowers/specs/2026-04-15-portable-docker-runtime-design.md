# Portable Docker-First Runtime Design

## Problem

The project currently runs as a **Cloudflare-first Discord automation worker suite**. Its runtime depends directly on Durable Objects, SQLite-in-Durable-Object storage, Worker `fetch` handlers, scheduled events, and Cloudflare-hosted WebSocket support.

That deployment model is useful, but it prevents operators from running the project in environments such as a self-hosted Docker container or a packaged Windows installation. The next step should make the application runnable outside Cloudflare without throwing away the existing Cloudflare deployment path.

## Goals

- Add a **portable runtime design** that supports running the project outside Cloudflare
- Make the first non-Cloudflare target a **single self-contained Docker container**
- Keep Cloudflare as a supported deployment target instead of replacing it
- Move Discord automation logic behind runtime-agnostic interfaces so it can be shared by Cloudflare and Docker/Node
- Keep the portable container self-contained: app process, gateway connection, HTTP surface, scheduler, and SQLite storage all ship together
- Preserve the existing operator-facing HTTP surfaces where practical: `/health`, `/interactions`, `/admin/gateway/status`, and `/admin/gateway/start`

## Non-Goals

- No Windows installer in this phase
- No external database requirement for the Docker target
- No rewrite into multiple services or microservices
- No attempt to remove Cloudflare-specific support from the repository
- No expansion into orchestration features beyond what is needed to run one container reliably

## Current Context

Today the repository is structured around Cloudflare primitives:

- `src/index.ts` exposes a Worker `fetch` entrypoint and `scheduled` bootstrap hook
- `GatewaySessionDO` owns the long-lived Discord Gateway socket and resume state
- `ModerationStoreDO` owns SQLite-backed config and timed-role persistence
- Admin routes proxy into Durable Objects rather than process-local services
- Timed-role expiry depends on Durable Object alarms

The core Discord behavior is already cohesive enough to preserve, but the runtime boundaries are not portable yet because business logic and Cloudflare hosting concerns are still interleaved.

## Decision Summary

- **Primary new target:** Docker on Linux/server
- **Packaging shape:** one self-contained container
- **Migration strategy:** introduce a portable runtime abstraction and keep Cloudflare as one adapter
- **Persistence choice for the portable runtime:** local SQLite database file, optionally backed by a mounted volume for durability across container restarts
- **Runtime model for the portable target:** a single Node.js process hosting HTTP routes, gateway lifecycle, storage access, and scheduling

## Recommended Architecture

Split the application into a **portable core** plus **platform adapters**.

### Portable core

The portable core should own:

- Discord interaction validation and command dispatch
- Slash-command sync orchestration
- Reaction moderation decisions
- Timed-role business rules
- Gateway event handling and resume-state decisions
- Admin-level gateway lifecycle logic

The core must not depend directly on Durable Objects, Worker request handling, or Cloudflare alarms.

### Platform adapters

Platform adapters should own environment-specific execution details:

- HTTP hosting
- persistent storage implementation
- timers and scheduled work
- gateway process/socket ownership
- environment/config loading

The repository should keep two adapters:

1. **Cloudflare adapter**
   - continues to use the Worker entrypoint and Durable Objects
   - delegates shared behavior into the portable core

2. **Node/Docker adapter**
   - runs as a normal Node process
   - hosts the HTTP API directly
   - manages the Discord gateway connection directly
   - persists state in SQLite

## Portable Runtime Components

The Docker-first runtime should be made of four focused components.

### 1. HTTP server

Expose:

- `GET /health`
- `POST /interactions`
- `GET /admin/gateway/status`
- `POST /admin/gateway/start`

This server should mirror the current operator surface closely enough that existing docs and integrations stay recognizable.

### 2. Gateway service

Own:

- opening and maintaining the Discord WebSocket connection
- identify/resume behavior
- heartbeat scheduling
- reconnect and backoff flow
- dispatching moderation-relevant events into shared logic
- tracking public gateway status and last error for admin inspection

This replaces `GatewaySessionDO` as the runtime owner in the Docker target.

### 3. Store

Replace Durable Object SQLite ownership with a portable storage abstraction backed by a local SQLite file.

The portable store should persist:

- guild blocklist data
- app config values that are currently persisted in the moderation store
- timed-role assignments
- gateway resume/session state

For the Docker target, the SQLite database lives inside the container filesystem, with an optional mounted volume for persistence across restarts.

### 4. Scheduler

Replace Cloudflare cron and Durable Object alarms with a small in-process scheduler that handles:

- timed-role expiry polling or next-expiry timers
- optional bootstrap/startup tasks that are currently triggered by the Worker schedule

The scheduler should stay simple and process-local for this phase. There is no need for a second worker process or an external queue.

## Data Flow

### Discord interactions

1. Discord sends an interaction to `/interactions`.
2. The HTTP server reads the raw body and signature headers.
3. Shared interaction validation verifies timestamp freshness and the Discord signature.
4. Shared command handlers execute against the portable store.
5. The runtime returns the same style of ephemeral Discord responses already used today.

### Gateway moderation flow

1. The gateway service opens the Discord WebSocket connection.
2. Incoming events are parsed and resume state is updated in the portable store.
3. Relevant reaction events are passed into the shared moderation logic.
4. The shared moderation logic reads blocklist configuration from the store and calls the Discord REST API as needed.

### Timed-role flow

1. A slash command writes or removes timed-role assignments through the store.
2. The scheduler checks the next expiry and wakes when work is due.
3. Expired assignments trigger Discord role removal.
4. Successful removals delete the timed-role row; failures remain persisted for explicit retry on the next scheduler pass.

### Admin flow

1. `/admin/gateway/status` reads the in-process gateway status snapshot.
2. `/admin/gateway/start` triggers the same sync-and-start bootstrap sequence used by startup logic.
3. Optional bearer auth remains supported through `ADMIN_AUTH_SECRET`.

## Self-Contained Container Design

The Docker target should ship as **one container that can run by itself**.

That container includes:

- Node.js runtime
- application code
- HTTP server
- gateway service
- scheduler
- SQLite support and migrations

The operator should only need:

- environment variables/secrets for Discord and optional admin auth
- an optional volume mount if they want durable on-disk SQLite state across container recreation

No external database, queue, or sidecar process is required in this phase.

## Error Handling

- Startup must **fail fast** if required Discord configuration is missing, the SQLite database cannot be opened, or migrations fail.
- The runtime must not silently degrade into a partial mode where HTTP succeeds but the gateway or scheduler is unusable without being reported clearly.
- `/admin/gateway/status` should expose enough state to diagnose runtime issues:
  - connection status
  - resume/session availability
  - backoff state
  - last gateway error
  - scheduler health if relevant
- Interaction signature failures should remain explicit `401` responses.
- Timed-role expiry failures should remain persisted so they can be retried instead of being dropped.
- Slash-command sync failures during bootstrap may be logged and surfaced, but they should not corrupt gateway state tracking.

## Compatibility Constraints

- Existing Cloudflare behavior should continue to work while the new runtime is introduced
- Business logic should not be duplicated between Cloudflare and Docker/Node paths
- The portable runtime should preserve the current HTTP route contract where practical
- The first portable runtime should stay container-first and self-contained rather than trying to solve packaging for every operating system at once

## Expected Repository Impact

The implementation will likely need changes in these areas:

- `src/index.ts` and related runtime entrypoint structure
- new abstractions for storage, gateway lifecycle, and scheduling
- extraction of business logic out of Durable Object-specific classes
- a new Node/Docker runtime entrypoint
- container packaging files such as a `Dockerfile` and related docs
- README updates for the new deployment option

## Testing

Keep the existing shared logic tests and add targeted portable-runtime coverage for:

- SQLite-backed storage behavior
- HTTP route wiring for `/health`, `/interactions`, and `/admin/gateway/*`
- gateway lifecycle orchestration and status reporting
- timed-role scheduling behavior using a controllable timer or fake clock
- bootstrap behavior when slash-command sync succeeds or fails
- startup validation for missing configuration and database open failures

The goal is to test the new runtime seams without duplicating every existing logic test.

## Validation

Validation for the eventual implementation should confirm that:

- the project can run as one self-contained Docker container
- the container can persist state with SQLite
- Discord interactions and admin routes are reachable without Cloudflare
- gateway startup, reconnect, and status reporting work outside Cloudflare
- timed-role expiry still survives process restarts when the SQLite file is preserved
- Cloudflare support remains intact after the runtime abstraction work

## Outcome

After this work, the repository should support two clear deployment shapes:

1. the existing Cloudflare-first deployment
2. a Docker-first self-contained runtime for operators who want to host the bot outside Cloudflare

That Docker-first runtime also creates the right foundation for a later Windows installer or other packaging format, because the core logic will already be separated from Cloudflare-specific hosting primitives.
