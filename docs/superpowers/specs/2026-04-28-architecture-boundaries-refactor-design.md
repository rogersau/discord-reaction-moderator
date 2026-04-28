# Architecture boundaries refactor design

## Problem

The codebase has grown from a focused Cloudflare Worker into a broader application with gateway lifecycle management, admin APIs, a React admin UI, timed roles, ticket workflows, transcript storage, and multiple Discord interaction paths.

The current deployment model is still workable, but the code boundaries are drifting:

- `ModerationStoreDO` owns too many unrelated persistence concerns
- route handlers and interaction handlers perform too much orchestration inline
- feature logic is split inconsistently between services, runtime handlers, and direct store calls
- `discord.ts` is a catch-all integration layer instead of a set of focused clients
- broad runtime contracts hide domain ownership instead of clarifying it

The requested change is to do the broad architecture cleanup, but stop short of a multi-worker platform split.

## Current context

- The project is already Cloudflare-only in production shape:
  - one Worker entrypoint
  - one gateway Durable Object
  - one storage Durable Object
  - one admin UI bundle
- `src/runtime/app.ts` composes the application cleanly at the top level, but downstream modules still mix transport, orchestration, and domain behavior.
- `src/durable-objects/moderation-store.ts` currently persists blocklist, app config, timed roles, ticket panels, ticket instances, and ticket counters.
- `src/runtime/application-command-handler.ts` and `src/runtime/ticket-interaction-handler.ts` contain large multi-step workflows that duplicate patterns already partially represented by services.
- The user wants the architecture improved in place, not re-deployed as multiple Workers or independently operated services.

## Scope

In scope:

- Refactor the application toward clearer bounded contexts inside the existing Worker deployment
- Split broad runtime contracts into domain-specific ports
- Move multi-step business workflows out of route and interaction handlers
- Break the broad Discord integration module into focused clients
- Reduce the monolithic nature of `ModerationStoreDO` by separating domain ownership and internal module structure
- Preserve existing user-facing behavior and endpoints unless a small compatibility-preserving adjustment is needed to support the refactor
- Update tests to reflect the new module boundaries

Out of scope:

- Splitting the system into multiple Workers or separately deployed services
- Rebuilding the product feature set
- Replacing Durable Objects with another storage technology
- Redesigning the admin UI information architecture as part of this refactor
- Changing the public API surface without a strong compatibility reason

## Options considered

### 1. Modularize in place only

Keep the current Durable Object and runtime shapes, but break large files into smaller modules and extract some helpers.

**Pros**

- Lowest migration risk
- Fastest way to improve readability

**Cons**

- Leaves the main architectural coupling intact
- Does not solve inconsistent ownership of business workflows
- Keeps storage and transport boundaries too broad

### 2. In-place bounded-context refactor

Keep one Worker deployment, but reorganize the codebase around domain boundaries, thin adapters, focused ports, and extracted workflows.

**Pros**

- Best maintainability improvement without adding operational complexity
- Preserves the working Cloudflare deployment model
- Makes testing and future feature work more predictable
- Allows the storage layer to be reshaped without forcing a platform rewrite

**Cons**

- Requires coordinated edits across runtime, services, Durable Objects, clients, and tests
- Needs careful sequencing to avoid regressions

### 3. Multi-worker decomposition

Split admin, gateway, and feature areas into separate Workers or services.

**Pros**

- Strongest runtime isolation
- Clearest operational separation

**Cons**

- Adds operational and deployment complexity the current product does not need
- Makes local reasoning and end-to-end change coordination harder
- Explicitly excluded from this work

## Selected approach

Use a hybrid of option 1 and option 2:

- modularize in place where the current structure is mostly sound
- refactor into bounded contexts where ownership is currently blurred
- do not pursue option 3

This keeps the refactor ambitious enough to pay down real design debt while staying inside the current deployment model.

## Design

### Architectural stance

The system remains:

- one Cloudflare Worker entrypoint
- one gateway runtime boundary
- one admin surface
- Durable Objects as the stateful backend

The architectural change is not a platform split. It is a code ownership split.

The target design should read as a set of explicit bounded contexts that happen to be deployed together.

### Target bounded contexts

The codebase should be organized around these contexts:

#### 1. Gateway context

Owns:

- gateway bootstrap
- gateway websocket lifecycle
- gateway status snapshot
- gateway event dispatch

Does not own:

- moderation rules storage
- ticket workflows
- admin transport handling

#### 2. Blocklist context

Owns:

- guild emoji normalization and blocklist mutations
- blocklist reads for slash commands and admin APIs
- reaction moderation policy decisions

Does not own:

- raw Discord transport parsing
- ticket or timed-role behavior

#### 3. Timed-role context

Owns:

- assignment lifecycle
- expiry semantics
- Discord role add/remove orchestration
- admin and interaction-facing timed-role use cases

Does not own:

- generic admin request parsing
- unrelated store concerns

#### 4. Ticket context

Owns:

- panel configuration
- ticket open and close workflows
- transcript generation and storage orchestration
- ticket-specific Discord message and channel operations

Does not own:

- blocklist or timed-role logic
- generic gateway state

#### 5. Admin context

Owns:

- authenticated operator routes
- request validation for admin APIs
- mapping admin transport requests to application use cases

Does not own:

- core feature workflows
- raw persistence details

### Layering model

Each context should follow the same basic shape.

#### 1. Transport adapters

Examples:

- HTTP route handlers
- Discord interaction handlers
- Durable Object internal request handlers

Responsibilities:

- parse request shape
- authenticate or verify signatures
- validate inputs
- call one application workflow
- map outputs and failures back to transport responses

Transport adapters should not own multi-step business logic.

#### 2. Application workflows

These are the core use cases of the system, such as:

- `assignTimedRole`
- `removeTimedRole`
- `openTicket`
- `closeTicket`
- `applyBlocklistMutation`
- `bootstrapGateway`

Responsibilities:

- orchestrate state reads and writes
- coordinate Discord side effects
- define compensation behavior when a multi-step operation fails
- return typed success and failure results suitable for multiple adapters

This becomes the main reuse layer between admin APIs, slash commands, and button/modal interactions.

#### 3. Domain modules

Responsibilities:

- pure business rules
- value normalization
- formatting helpers tied to domain semantics
- domain-specific validation rules

Examples already present include pieces of `blocklist.ts`, `tickets.ts`, and `timed-roles.ts`. Those modules should stay pure or become more purely domain-focused rather than accumulating API orchestration.

#### 4. Infrastructure adapters

Examples:

- Durable Object clients
- Discord REST clients
- R2 transcript blob adapter

Responsibilities:

- encapsulate request shapes
- map remote errors into explicit application-level errors
- hide internal fetch paths and remote payload details from the application layer

### Runtime contract split

The current `RuntimeStore` contract is too broad. It should be replaced by smaller ports that match the bounded contexts.

Target store ports:

- `BlocklistStore`
- `AppConfigStore`
- `TimedRoleStore`
- `TicketStore`
- `GatewayStatusStore` only if a workflow truly needs stored gateway state outside the gateway context

Likewise, `GatewayController` should stay narrow and focused on gateway lifecycle operations, not become a catch-all runtime abstraction.

The application composition root can still assemble a single Cloudflare context object, but the values inside it should be focused interfaces instead of one omnibus store contract.

### Durable Object refactor

The first refactor step should be internal modularization, not immediate runtime fan-out.

#### ModerationStoreDO

Keep a single storage Durable Object initially, but split its implementation into internal modules by context:

- blocklist persistence
- app config persistence
- timed-role persistence and alarms
- ticket persistence

The Durable Object class should become a thin request router over domain-specific storage modules instead of one file that implements every query and mutation inline.

After that boundary exists, ticket persistence can be evaluated for extraction into a dedicated Durable Object if the codebase still benefits from it. That extraction is optional and should not be the first move.

#### GatewaySessionDO

Keep `GatewaySessionDO` focused on websocket lifecycle and durable session state.

Reaction-specific moderation behavior should flow through extracted event handlers or gateway workflows instead of being embedded directly inside the websocket session implementation.

### Discord client split

`src/discord.ts` should be split into focused infrastructure modules, for example:

- `discord/client.ts` for shared request helpers and error mapping
- `discord/guilds.ts` for guild, channel, role, and permission resource reads
- `discord/messages.ts` for message create/list operations
- `discord/channels.ts` for ticket channel create/delete operations
- `discord/members.ts` for role add/remove operations
- `discord/commands.ts` for application command sync
- `discord/transcripts.ts` for transcript upload-related operations

The goal is to make dependencies obvious. A ticket workflow should not import a generic file that also owns slash command sync and permission inspection.

### Interaction and admin handler cleanup

`application-command-handler.ts`, `ticket-interaction-handler.ts`, and large parts of `admin-routes.ts` should stop doing business orchestration inline.

Target direction:

- handlers decode the incoming request
- handlers call one workflow
- workflows use focused stores and clients
- handlers map workflow results to Discord or HTTP responses

This should remove duplication between:

- admin timed-role mutations and slash-command timed-role mutations
- admin blocklist mutations and slash-command blocklist mutations
- ticket close flows triggered by different interaction types

### Error model

The refactor should introduce explicit error categories for infrastructure-backed workflows.

At minimum, workflows should distinguish between:

- invalid input
- authorization or permission failure
- missing state
- Discord side-effect failure
- persistence failure
- rollback failure

Transport layers can then consistently map these errors to:

- Discord ephemeral messages
- admin JSON errors
- internal logs

The design should not add silent fallbacks or broad catch-and-ignore behavior.

### Testing model

Tests should follow the new boundaries.

Target testing split:

- domain tests for pure blocklist, timed-role, and ticket helpers
- workflow tests for ticket open/close, timed-role assignment/removal, blocklist mutation, and gateway bootstrap orchestration
- adapter tests for admin routes and Discord interaction handlers
- Durable Object tests for storage behavior and alarm semantics

The main benefit is that feature changes should be testable without always going through the full route or interaction surface.

## Suggested code structure

The exact filenames can vary, but the repository should move toward a structure like this:

```text
src/
  admin/
  blocklist/
    domain/
    workflows/
    store/
  gateway/
    domain/
    workflows/
    events/
  tickets/
    domain/
    workflows/
    store/
  timed-roles/
    domain/
    workflows/
    store/
  discord/
    client.ts
    channels.ts
    commands.ts
    guilds.ts
    members.ts
    messages.ts
    transcripts.ts
  durable-objects/
    gateway-session.ts
    moderation-store.ts
    moderation-store/
      app-config-store.ts
      blocklist-store.ts
      ticket-store.ts
      timed-role-store.ts
  routes/
  runtime/
```

This is a directional structure, not a requirement to rename every existing file immediately.

## Migration strategy

Implement in phases.

### Phase 1. Contract and module extraction

- split `discord.ts` into focused clients without changing behavior
- extract store ports from `RuntimeStore`
- move reusable workflow logic out of interaction and admin handlers

### Phase 2. Durable Object internal decomposition

- split `ModerationStoreDO` into internal storage modules
- keep the external behavior compatible while tightening internal boundaries

### Phase 3. Adapter cleanup

- simplify admin route handlers
- simplify slash-command and ticket interaction handlers
- make `runtime/app.ts` compose use cases instead of broad services plus direct helper calls

### Phase 4. Optional persistence split

- evaluate whether ticket persistence should move into its own Durable Object
- only do this if the phase-2 structure still leaves ticket ownership awkward

This phase is explicitly optional. The architectural success criteria do not require a second persistence Durable Object.

## Success criteria

The refactor is successful when:

- route and interaction handlers are thin transport adapters
- shared feature workflows are reused across admin and Discord entry points
- `discord.ts` no longer exists as a catch-all module
- `RuntimeStore` has been replaced or reduced to focused ports
- `ModerationStoreDO` no longer reads as a monolithic persistence file
- the current deployment model and feature set remain intact

## Risks and mitigations

### Risk: refactor turns into a rewrite

Mitigation:

- preserve current endpoints and external behavior
- sequence extraction before behavior change
- phase optional work behind explicit evaluation gates

### Risk: ticket workflows regress during extraction

Mitigation:

- add workflow-level tests before or during extraction
- move close/open logic into dedicated modules with existing behavior preserved

### Risk: storage contracts churn too broadly

Mitigation:

- introduce focused ports behind the current composition root first
- migrate one consumer path at a time

### Risk: too much abstraction replaces one broad abstraction with many weak ones

Mitigation:

- only keep interfaces that express real domain ownership
- avoid creating empty wrapper layers

## Non-goals and explicit exclusions

- No multi-worker decomposition
- No microservice split
- No requirement to create a dedicated Durable Object for every feature
- No large admin UI redesign bundled into this refactor

The point is clearer boundaries, not more deployment units.
