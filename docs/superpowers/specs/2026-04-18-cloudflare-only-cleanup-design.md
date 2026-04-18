# Cloudflare-only cleanup design

## Problem

The codebase currently supports both Cloudflare and a portable Node/Docker runtime.

That portability has become a source of architectural drag:

- gateway lifecycle logic exists in two places
- storage and timed-role expiry behavior are implemented twice
- the main runtime app is shaped around portability abstractions instead of the actual production platform
- legacy operator surfaces remain because multiple runtime modes were being preserved

The requested change is to go all in on Cloudflare hosting and use that decision to clean up the architecture rather than only deleting deployment files.

## Current context

- Production-facing behavior is already Cloudflare-first: the Worker entrypoint, Durable Objects, alarms, and Discord gateway session all center Cloudflare.
- The admin UI is already a browser-based operator surface and does not depend on Node hosting as a user-facing requirement.
- The current dual-runtime model introduced:
  - `GatewaySessionDO` and a separate Node gateway service
  - Durable Object SQLite storage and a separate Node SQLite runtime store
  - a broad runtime abstraction layer that exists largely to keep both targets aligned
- The user wants a broad refactor, but it is acceptable to remove or replace legacy admin and gateway surfaces if the Cloudflare-only result is cleaner.

## Scope

In scope:

- Make Cloudflare the only supported runtime and hosting target
- Remove Node/Docker portability code and build paths
- Refactor the runtime shape so it reads as a Cloudflare-native application instead of a portable runtime
- Split the current oversized runtime app into clearer routing, service, and client boundaries
- Remove or replace legacy operator surfaces that no longer make sense in a Cloudflare-only architecture
- Preserve the current product capabilities where practical:
  - health endpoint
  - Discord interactions
  - gateway control and status
  - blocklist management
  - timed-role management
  - ticket-panel management and ticket workflow
- Update tests so they reflect the Cloudflare-only architecture rather than Node parity

Out of scope:

- Rewriting the feature set
- Replacing Durable Objects with a different Cloudflare storage product
- Redesigning the admin UI from scratch
- Expanding the product surface while doing the cleanup
- Introducing a second non-Cloudflare hosting path

## Options considered

### 1. Minimal Cloudflare-only cut

Delete Node and Docker support, then keep most of the current runtime shape intact.

**Pros**

- Lowest short-term refactor risk
- Fastest way to stop supporting the extra runtime

**Cons**

- Leaves the main architectural debt mostly untouched
- Keeps `app.ts` too large
- Misses the chance to simplify boundaries that only existed for portability

### 2. Cloudflare-first cleanup

Delete Node and Docker support and use that change to simplify the runtime boundary, routing, and service ownership while preserving the existing feature set.

**Pros**

- Captures most of the architecture win without becoming a rewrite
- Removes portability-driven abstractions
- Produces clearer Cloudflare-native module ownership
- Keeps feature regression risk manageable

**Cons**

- Broader than a simple de-porting pass
- Requires coordinated edits across runtime, Durable Object clients, admin APIs, and tests

### 3. Full platform-native redesign

Treat the Cloudflare-only decision as an opportunity for a deeper redesign of storage, runtime flow, and admin APIs.

**Pros**

- Cleanest possible end state
- Maximum freedom to reshape the codebase

**Cons**

- Highest regression risk
- More likely to turn into a rewrite than a cleanup
- Harder to bound and verify in one implementation pass

## Selected approach

Use option 2: Cloudflare-first cleanup.

This keeps the refactor ambitious enough to pay down the important technical debt, but bounded enough to stay focused on the current feature set. The goal is not to rebuild the product. The goal is to make the existing product read and behave like a clean Cloudflare-native system.

## Design

### Platform stance

Cloudflare becomes the only supported production and deployment target.

The codebase should stop presenting itself as a portable runtime with Cloudflare support. Instead, it should present itself as:

- one Worker entrypoint
- a small set of Cloudflare-native Durable Objects
- shared domain and workflow modules
- one authenticated admin surface

This means removing Node- and Docker-specific runtime code, build targets, and portability contracts that no longer serve the system.

### Top-level runtime structure

The cleaned architecture should use four explicit layers.

#### 1. Entry layer

`src/index.ts` remains the Worker entrypoint, but only as thin composition:

- build per-request app context
- dispatch to route handlers
- trigger scheduled bootstrap behavior

The entrypoint should not contain feature workflows.

#### 2. Route layer

HTTP handling should be split into focused route modules:

- public routes such as `/health`
- Discord interaction routes such as `/interactions`
- admin shell and `/admin/api/*`

Each route module should be responsible for:

- request parsing
- authentication or signature verification
- calling the correct workflow or client method
- mapping success and failure to HTTP responses

The route layer should not own multi-step business workflows.

#### 3. Service layer

Feature workflows should move into focused services, for example:

- blocklist services
- timed-role services
- ticket services
- gateway bootstrap and status services

Service modules should own operations that combine validation, storage mutation, and Discord API calls.

This is where orchestration belongs, not in `app.ts` and not inline inside route branches.

#### 4. Durable Object client layer

Cloudflare-native client modules should wrap the internal Durable Object calls:

- `store-client/*` for `MODERATION_STORE_DO`
- `gateway-client/*` for `GATEWAY_SESSION_DO`

These clients should be the only modules that know the internal request paths or Durable Object request formats.

The rest of the app should depend on typed client methods, not raw internal fetch calls and not portable runtime interfaces.

### Durable Object ownership

Durable Object responsibilities should become explicit.

#### GatewaySessionDO

`GatewaySessionDO` should own only gateway session lifecycle concerns:

- connect
- resume
- heartbeat
- backoff
- live status snapshot

It may still invoke event-specific handlers when gateway messages matter to the application, but it should not mix websocket lifecycle code with broad application orchestration.

The goal is to keep the gateway runtime-specific and keep business behavior extracted.

#### ModerationStoreDO

`ModerationStoreDO` should remain the source of truth for persistent application state:

- blocklists
- app config
- timed roles
- ticket panels
- ticket instances
- timed-role alarms

This Durable Object should be treated as the durable state boundary of the application, not as one interchangeable backend among several.

### Removal of portability abstractions

The cleanup should remove abstractions that only existed to preserve Node parity.

That includes:

- Node runtime files under `src/runtime/node-*`
- Node-specific SQLite runtime store code
- Docker packaging for the standalone runtime
- broad portable contracts such as runtime store and gateway controller abstractions where they are no longer adding clarity

Some abstractions should remain if they still improve clarity inside the Cloudflare-only codebase, but the standard should change:

- keep abstractions that express domain boundaries
- remove abstractions that only express hosting portability

### Admin surface

The admin dashboard remains the supported operator surface.

The cleaned operator model should be:

- browser-based session auth
- `/admin` for the dashboard shell
- `/admin/api/*` for authenticated admin actions

Legacy gateway control endpoints that exist only to preserve alternate auth or older operator flows should be removed if the dashboard and session-protected APIs replace them cleanly.

The admin auth model should also be simplified:

- one browser-first auth flow
- one dedicated session-signing secret
- no fallback where a login secret doubles as the session-signing key unless there is a strong platform reason and it is made explicit

### Data flow

Expected runtime flow:

1. The Worker entrypoint creates Cloudflare app context for the request.
2. The route layer authenticates or verifies the request.
3. The route layer invokes a focused service or Durable Object client.
4. Services orchestrate domain behavior and call:
   - Durable Object clients for persisted state
   - Discord API helpers for external side effects
5. Durable Objects remain the stateful boundaries for gateway session and stored application state.

Expected gateway flow:

1. The scheduled Worker event or admin action requests gateway bootstrap.
2. `GatewaySessionDO` manages the websocket session lifecycle.
3. When actionable events arrive, extracted handlers apply application logic with help from the store client and Discord API helpers.
4. Status reads flow through the gateway client instead of being embedded directly into unrelated route code.

### Error handling

The refactor should make error ownership more explicit.

- Route handlers should translate outcomes into HTTP or Discord responses.
- Service modules should own workflow failures and compensating actions.
- Durable Object client modules should surface clear failures for internal state operations.

The cleanup should reduce large inline `try/catch` blocks that both orchestrate workflows and decide user-facing responses at the same time.

Instead, the architecture should bias toward:

- explicit service failures
- targeted compensation where needed
- logging at the boundary where failure meaning is clear

It should not add silent fallbacks or vague success-shaped behavior.

### Testing and verification

The test strategy should stop optimizing for Node parity and start optimizing for the Cloudflare-only architecture.

Update coverage around:

- Worker-facing route behavior
- admin auth and `/admin/api/*` authorization
- interaction routing
- timed-role workflow services
- ticket workflow services
- Durable Object client contracts
- Durable Object behavior that remains business critical

Tests that exist only to preserve the portable runtime should be removed or rewritten to target the new boundaries.

The build and verification surface should also become simpler:

- remove Node runtime build and packaging verification tied to standalone hosting
- keep type-checking and tests for the Cloudflare-native code path
- keep admin bundle verification as part of the supported application build

### File and module expectations

The exact filenames can shift during implementation, but the refactor should move toward a structure that clearly communicates intent, such as:

- `src/index.ts`
- `src/admin/*`
- `src/routes/*`
- `src/services/*`
- `src/clients/store-client/*`
- `src/clients/gateway-client/*`
- `src/durable-objects/*`
- `src/discord/*` or existing Discord helper modules if they remain clear and focused

The important change is not the folder names alone. The important change is that each layer has one clear purpose.

## Success criteria

- Cloudflare is the only supported runtime target
- Node/Docker hosting paths are removed
- The main runtime composition is split into smaller route and service modules
- Durable Object ownership is explicit and Cloudflare-native
- The admin dashboard remains the supported operator surface
- Legacy operator surfaces are removed where the cleaner Cloudflare-only path replaces them
- The codebase no longer depends on portability abstractions that only existed for Node parity
- Tests reflect the new architecture rather than the old portability model

## Risks and mitigations

### Risk: refactor sprawl

This cleanup can expand too easily if every awkward boundary is treated as fair game.

**Mitigation**

Keep the feature set stable and focus the refactor on boundaries created or distorted by portability.

### Risk: accidental admin regression

The admin runtime and API surface are tightly coupled to the current `app.ts`.

**Mitigation**

Refactor the admin routes behind stable behavior-oriented tests before removing legacy paths.

### Risk: gateway regressions

Gateway lifecycle behavior is critical and stateful.

**Mitigation**

Keep `GatewaySessionDO` ownership narrow and preserve behavior while extracting handlers around it instead of rewriting the websocket lifecycle from scratch.

## Notes

- This design intentionally does not require a full rewrite of storage or the Discord feature set.
- The cleanup should prefer clearer boundaries over maximum abstraction.
- The platform decision is the simplifying force: once Cloudflare is the only target, the code should stop paying abstraction cost for a runtime that no longer exists.
