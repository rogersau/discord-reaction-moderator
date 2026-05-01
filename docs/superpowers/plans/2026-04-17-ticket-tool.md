# Ticket Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a web-configured Discord ticket system that publishes a multi-button ticket panel, collects modal answers, creates private ticket channels, supports in-Discord close actions, and saves transcripts to a Discord log channel before deleting the ticket channel.

**Architecture:** Extend the shared runtime store with ticket panel config and live ticket instance state, keep Discord REST operations in focused helper modules, and wire the runtime app so the admin UI handles configuration while `/interactions` handles ticket lifecycle. Split the admin UI by adding a focused ticket editor component instead of growing `src/admin/App.tsx` further.

**Tech Stack:** TypeScript, React, Cloudflare Workers, SQLite-backed Durable Objects, Discord interactions API, Discord REST API, Node test runner, Wrangler

---

## File Map

- `src/types.ts` — add shared ticket config, question, answer, and live ticket instance types used by both runtimes.
- `src/runtime/admin-types.ts` — define admin API payloads and guild resource response shapes for ticket configuration.
- `src/runtime/contracts.ts` — extend `RuntimeStore` with ticket panel and ticket instance persistence methods.
- `src/runtime/sqlite-store.ts` — add Node runtime SQLite tables and methods for ticket panel config and ticket instances.
- `src/durable-objects/moderation-store.ts` — add Durable Object SQLite tables plus HTTP endpoints for ticket config and ticket instance persistence.
- `src/runtime/cloudflare-runtime.ts` — proxy the new ticket persistence methods to `ModerationStoreDO`.
- `src/discord.ts` — add Discord REST helpers for guild metadata lookup, channel/message management, transcript upload, and ticket channel deletion.
- `src/tickets.ts` — new focused ticket helper module for custom IDs, modal responses, transcript rendering, and channel naming.
- `src/runtime/app.ts` — add ticket admin APIs, panel publish logic, and Discord component/modal lifecycle handling.
- `src/admin/App.tsx` — insert the ticketing section into the dashboard and refresh overview data after ticket config changes.
- `src/admin/components/ticket-panel-editor.tsx` — new ticket panel editor UI with friendly Discord-name pickers and ticket-type question management.
- `test/sqlite-store.test.ts` — persistence coverage for ticket panels and live ticket instances in the Node runtime store.
- `test/blocklist.test.ts` — Durable Object HTTP endpoint coverage for ticket config and ticket instance persistence.
- `test/discord.test.ts` — request-shape coverage for new Discord REST helpers.
- `test/tickets.test.ts` — pure ticket helper coverage for modal construction, custom ID parsing, transcript rendering, and channel naming.
- `test/runtime-app.test.ts` — session-protected admin API coverage plus runtime ticket open/close lifecycle coverage.
- `test/admin-app.test.tsx` — SSR coverage for the new dashboard ticketing section and friendly-name operator surface.
- `test/interaction-routes.test.ts` — signed Worker-level coverage for ticket component and modal interactions.
- `README.md` — document ticket setup, required bot permissions, panel publishing, and transcript behavior.

### Task 1: Add shared ticket types and SQLite runtime persistence

**Files:**

- Modify: `src/types.ts`
- Modify: `src/runtime/admin-types.ts`
- Modify: `src/runtime/contracts.ts`
- Modify: `src/runtime/sqlite-store.ts`
- Test: `test/sqlite-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/sqlite-store.test.ts
import type { TicketPanelConfig, TicketInstance } from "../src/types";

test("sqlite runtime store persists ticket panel config and ticket instances", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });

    const panel: TicketPanelConfig = {
      guildId: "guild-1",
      panelChannelId: "panel-channel-1",
      categoryChannelId: "category-1",
      transcriptChannelId: "transcript-1",
      panelMessageId: null,
      ticketTypes: [
        {
          id: "appeals",
          label: "Appeal",
          emoji: "🧾",
          buttonStyle: "primary",
          supportRoleId: "role-1",
          channelNamePrefix: "appeal",
          questions: [
            {
              id: "reason",
              label: "Why are you opening this ticket?",
              style: "paragraph",
              placeholder: "Explain the situation",
              required: true,
            },
          ],
        },
      ],
    };

    const instance: TicketInstance = {
      guildId: "guild-1",
      channelId: "ticket-channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "open",
      answers: [
        { questionId: "reason", label: "Why are you opening this ticket?", value: "Need help" },
      ],
      openedAtMs: 1000,
      closedAtMs: null,
      closedByUserId: null,
      transcriptMessageId: null,
    };

    await store.upsertTicketPanelConfig(panel);
    await store.createTicketInstance(instance);

    assert.deepEqual(await store.readTicketPanelConfig("guild-1"), panel);
    assert.deepEqual(await store.readOpenTicketByChannel("guild-1", "ticket-channel-1"), instance);

    await store.closeTicketInstance({
      guildId: "guild-1",
      channelId: "ticket-channel-1",
      closedByUserId: "user-2",
      closedAtMs: 2000,
      transcriptMessageId: "transcript-message-1",
    });

    assert.equal(await store.readOpenTicketByChannel("guild-1", "ticket-channel-1"), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/sqlite-store.test.js`  
Expected: FAIL with TypeScript compile errors or runtime errors for missing ticket types/methods such as `upsertTicketPanelConfig`, `createTicketInstance`, or `readOpenTicketByChannel`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/types.ts
export interface TicketQuestion {
  id: string;
  label: string;
  style: "short" | "paragraph";
  placeholder: string;
  required: boolean;
}

export interface TicketTypeConfig {
  id: string;
  label: string;
  emoji: string;
  buttonStyle: "primary" | "secondary" | "success" | "danger";
  supportRoleId: string;
  channelNamePrefix: string;
  questions: TicketQuestion[];
}

export interface TicketPanelConfig {
  guildId: string;
  panelChannelId: string;
  categoryChannelId: string;
  transcriptChannelId: string;
  panelMessageId: string | null;
  ticketTypes: TicketTypeConfig[];
}

export interface TicketAnswer {
  questionId: string;
  label: string;
  value: string;
}

export interface TicketInstance {
  guildId: string;
  channelId: string;
  ticketTypeId: string;
  ticketTypeLabel: string;
  openerUserId: string;
  supportRoleId: string;
  status: "open" | "closed";
  answers: TicketAnswer[];
  openedAtMs: number;
  closedAtMs: number | null;
  closedByUserId: string | null;
  transcriptMessageId: string | null;
}
```

```ts
// src/runtime/admin-types.ts
import type { TicketPanelConfig } from "../types";

export interface GuildTicketResourceSummary {
  id: string;
  name: string;
}

export interface GuildTicketResources {
  guildId: string;
  roles: GuildTicketResourceSummary[];
  categories: GuildTicketResourceSummary[];
  textChannels: GuildTicketResourceSummary[];
}

export interface TicketPanelPublishMutation {
  guildId: string;
}

export type TicketPanelConfigMutation = TicketPanelConfig;
```

```ts
// src/runtime/contracts.ts
import type { TicketInstance, TicketPanelConfig } from "../types";

export interface RuntimeStore {
  // existing methods...
  readTicketPanelConfig(guildId: string): Promise<TicketPanelConfig | null>;
  upsertTicketPanelConfig(panel: TicketPanelConfig): Promise<void>;
  createTicketInstance(instance: TicketInstance): Promise<void>;
  readOpenTicketByChannel(guildId: string, channelId: string): Promise<TicketInstance | null>;
  closeTicketInstance(input: {
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string;
  }): Promise<void>;
}
```

```ts
// src/runtime/sqlite-store.ts
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_panels (
    guild_id TEXT PRIMARY KEY,
    panel_channel_id TEXT NOT NULL,
    category_channel_id TEXT NOT NULL,
    transcript_channel_id TEXT NOT NULL,
    panel_message_id TEXT,
    ticket_types_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ticket_instances (
    guild_id TEXT NOT NULL,
    channel_id TEXT PRIMARY KEY,
    ticket_type_id TEXT NOT NULL,
    ticket_type_label TEXT NOT NULL,
    opener_user_id TEXT NOT NULL,
    support_role_id TEXT NOT NULL,
    status TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    opened_at_ms INTEGER NOT NULL,
    closed_at_ms INTEGER,
    closed_by_user_id TEXT,
    transcript_message_id TEXT
  );
`);

const upsertTicketPanelStmt = db.prepare(`
  INSERT INTO ticket_panels(guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json)
  VALUES(?, ?, ?, ?, ?, ?)
  ON CONFLICT(guild_id)
  DO UPDATE SET
    panel_channel_id = excluded.panel_channel_id,
    category_channel_id = excluded.category_channel_id,
    transcript_channel_id = excluded.transcript_channel_id,
    panel_message_id = excluded.panel_message_id,
    ticket_types_json = excluded.ticket_types_json
`);

const selectTicketPanelStmt = db.prepare(`
  SELECT guild_id, panel_channel_id, category_channel_id, transcript_channel_id, panel_message_id, ticket_types_json
  FROM ticket_panels
  WHERE guild_id = ?
`);

const insertTicketInstanceStmt = db.prepare(`
  INSERT INTO ticket_instances(guild_id, channel_id, ticket_type_id, ticket_type_label, opener_user_id, support_role_id, status, answers_json, opened_at_ms, closed_at_ms, closed_by_user_id, transcript_message_id)
  VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const selectOpenTicketInstanceStmt = db.prepare(`
  SELECT * FROM ticket_instances
  WHERE guild_id = ? AND channel_id = ? AND status = 'open'
`);

const closeTicketInstanceStmt = db.prepare(`
  UPDATE ticket_instances
  SET status = 'closed',
      closed_at_ms = ?,
      closed_by_user_id = ?,
      transcript_message_id = ?
  WHERE guild_id = ? AND channel_id = ?
`);

async readTicketPanelConfig(guildId: string) {
  const row = selectTicketPanelStmt.get(guildId) as
    | { guild_id: string; panel_channel_id: string; category_channel_id: string; transcript_channel_id: string; panel_message_id: string | null; ticket_types_json: string }
    | undefined;
  if (!row) return null;
  return {
    guildId: row.guild_id,
    panelChannelId: row.panel_channel_id,
    categoryChannelId: row.category_channel_id,
    transcriptChannelId: row.transcript_channel_id,
    panelMessageId: row.panel_message_id,
    ticketTypes: JSON.parse(row.ticket_types_json),
  };
},

async upsertTicketPanelConfig(panel) {
  upsertTicketPanelStmt.run(
    panel.guildId,
    panel.panelChannelId,
    panel.categoryChannelId,
    panel.transcriptChannelId,
    panel.panelMessageId,
    JSON.stringify(panel.ticketTypes)
  );
},

async createTicketInstance(instance) {
  insertTicketInstanceStmt.run(
    instance.guildId,
    instance.channelId,
    instance.ticketTypeId,
    instance.ticketTypeLabel,
    instance.openerUserId,
    instance.supportRoleId,
    instance.status,
    JSON.stringify(instance.answers),
    instance.openedAtMs,
    instance.closedAtMs,
    instance.closedByUserId,
    instance.transcriptMessageId
  );
},

async readOpenTicketByChannel(guildId, channelId) {
  const row = selectOpenTicketInstanceStmt.get(guildId, channelId) as
    | { guild_id: string; channel_id: string; ticket_type_id: string; ticket_type_label: string; opener_user_id: string; support_role_id: string; status: "open" | "closed"; answers_json: string; opened_at_ms: number; closed_at_ms: number | null; closed_by_user_id: string | null; transcript_message_id: string | null }
    | undefined;
  if (!row) return null;
  return {
    guildId: row.guild_id,
    channelId: row.channel_id,
    ticketTypeId: row.ticket_type_id,
    ticketTypeLabel: row.ticket_type_label,
    openerUserId: row.opener_user_id,
    supportRoleId: row.support_role_id,
    status: row.status,
    answers: JSON.parse(row.answers_json),
    openedAtMs: row.opened_at_ms,
    closedAtMs: row.closed_at_ms,
    closedByUserId: row.closed_by_user_id,
    transcriptMessageId: row.transcript_message_id,
  };
},

async closeTicketInstance(input) {
  closeTicketInstanceStmt.run(
    input.closedAtMs,
    input.closedByUserId,
    input.transcriptMessageId,
    input.guildId,
    input.channelId
  );
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/sqlite-store.test.js`  
Expected: PASS for the new ticket panel and ticket instance persistence test.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/runtime/admin-types.ts src/runtime/contracts.ts src/runtime/sqlite-store.ts test/sqlite-store.test.ts
git commit -m "feat: persist ticket panel state" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Add Durable Object ticket persistence and Cloudflare runtime proxies

**Files:**

- Modify: `src/durable-objects/moderation-store.ts`
- Modify: `src/runtime/cloudflare-runtime.ts`
- Test: `test/blocklist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/blocklist.test.ts
test("ModerationStoreDO stores ticket panels and ticket instances through HTTP endpoints", async () => {
  const store = new ModerationStoreDO(createState(), {
    BOT_USER_ID: "bot-user-id",
    DISCORD_BOT_TOKEN: "token",
  } as Env);

  const panel = {
    guildId: "guild-1",
    panelChannelId: "panel-channel-1",
    categoryChannelId: "category-1",
    transcriptChannelId: "transcript-1",
    panelMessageId: null,
    ticketTypes: [],
  };

  const savePanel = await store.fetch(
    new Request("https://moderation-store/ticket-panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(panel),
    }),
  );
  assert.equal(savePanel.status, 200);

  const readPanel = await store.fetch(
    new Request("https://moderation-store/ticket-panel?guildId=guild-1"),
  );
  assert.deepEqual(await readPanel.json(), panel);

  const createTicket = await store.fetch(
    new Request("https://moderation-store/ticket-instance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        channelId: "ticket-channel-1",
        ticketTypeId: "appeals",
        ticketTypeLabel: "Appeal",
        openerUserId: "user-1",
        supportRoleId: "role-1",
        status: "open",
        answers: [],
        openedAtMs: 1000,
        closedAtMs: null,
        closedByUserId: null,
        transcriptMessageId: null,
      }),
    }),
  );
  assert.equal(createTicket.status, 200);

  const readOpen = await store.fetch(
    new Request(
      "https://moderation-store/ticket-instance/open?guildId=guild-1&channelId=ticket-channel-1",
    ),
  );
  assert.equal((await readOpen.json()).status, "open");

  const closeTicket = await store.fetch(
    new Request("https://moderation-store/ticket-instance/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        channelId: "ticket-channel-1",
        closedByUserId: "user-2",
        closedAtMs: 2000,
        transcriptMessageId: "transcript-message-1",
      }),
    }),
  );
  assert.equal(closeTicket.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/blocklist.test.js`  
Expected: FAIL with `404` responses for `/ticket-panel` or `/ticket-instance` endpoints, or missing runtime proxy methods when the Node test suite compiles.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/durable-objects/moderation-store.ts
this.sql.exec(`
  CREATE TABLE IF NOT EXISTS ticket_panels (
    guild_id TEXT PRIMARY KEY,
    panel_channel_id TEXT NOT NULL,
    category_channel_id TEXT NOT NULL,
    transcript_channel_id TEXT NOT NULL,
    panel_message_id TEXT,
    ticket_types_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ticket_instances (
    guild_id TEXT NOT NULL,
    channel_id TEXT PRIMARY KEY,
    ticket_type_id TEXT NOT NULL,
    ticket_type_label TEXT NOT NULL,
    opener_user_id TEXT NOT NULL,
    support_role_id TEXT NOT NULL,
    status TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    opened_at_ms INTEGER NOT NULL,
    closed_at_ms INTEGER,
    closed_by_user_id TEXT,
    transcript_message_id TEXT
  );
`);

if (request.method === "GET" && url.pathname === "/ticket-panel") {
  const guildId = url.searchParams.get("guildId");
  return Response.json(guildId ? this.readTicketPanelConfig(guildId) : null);
}

if (request.method === "POST" && url.pathname === "/ticket-panel") {
  const body = parseTicketPanelConfig(await request.json());
  await this.upsertTicketPanelConfig(body);
  return Response.json(body);
}

if (request.method === "POST" && url.pathname === "/ticket-instance") {
  const body = parseTicketInstance(await request.json());
  await this.createTicketInstance(body);
  return Response.json({ ok: true });
}

if (request.method === "GET" && url.pathname === "/ticket-instance/open") {
  const guildId = url.searchParams.get("guildId");
  const channelId = url.searchParams.get("channelId");
  return Response.json(
    guildId && channelId ? this.readOpenTicketByChannel(guildId, channelId) : null,
  );
}

if (request.method === "POST" && url.pathname === "/ticket-instance/close") {
  const body = parseTicketCloseMutation(await request.json());
  await this.closeTicketInstance(body);
  return Response.json({ ok: true });
}
```

```ts
// src/runtime/cloudflare-runtime.ts
async readTicketPanelConfig(guildId) {
  const response = await storeStub.fetch(
    `https://moderation-store/ticket-panel?guildId=${encodeURIComponent(guildId)}`
  );
  return response.json();
},

async upsertTicketPanelConfig(panel) {
  const response = await storeStub.fetch("https://moderation-store/ticket-panel", {
    method: "POST",
    body: JSON.stringify(panel),
  });
  if (!response.ok) {
    throw new Error(`Failed to upsert ticket panel: ${response.status} ${await response.text()}`);
  }
},

async createTicketInstance(instance) {
  const response = await storeStub.fetch("https://moderation-store/ticket-instance", {
    method: "POST",
    body: JSON.stringify(instance),
  });
  if (!response.ok) {
    throw new Error(`Failed to create ticket instance: ${response.status} ${await response.text()}`);
  }
},

async readOpenTicketByChannel(guildId, channelId) {
  const response = await storeStub.fetch(
    `https://moderation-store/ticket-instance/open?guildId=${encodeURIComponent(guildId)}&channelId=${encodeURIComponent(channelId)}`
  );
  return response.json();
},

async closeTicketInstance(body) {
  const response = await storeStub.fetch("https://moderation-store/ticket-instance/close", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Failed to close ticket instance: ${response.status} ${await response.text()}`);
  }
},
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/blocklist.test.js`  
Expected: PASS for the new Durable Object ticket persistence endpoint coverage.

- [ ] **Step 5: Commit**

```bash
git add src/durable-objects/moderation-store.ts src/runtime/cloudflare-runtime.ts test/blocklist.test.ts
git commit -m "feat: add cloudflare ticket persistence" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Build ticket helpers and Discord REST clients

**Files:**

- Create: `src/tickets.ts`
- Modify: `src/discord.ts`
- Test: `test/tickets.test.ts`
- Test: `test/discord.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/tickets.test.ts
import {
  buildTicketModalResponse,
  buildTicketOpenCustomId,
  buildTicketCloseCustomId,
  parseTicketCustomId,
  renderTicketTranscript,
} from "../src/tickets";

test("buildTicketModalResponse uses modal questions and Discord text input rows", () => {
  const response = buildTicketModalResponse({
    id: "appeals",
    label: "Appeal",
    emoji: "🧾",
    buttonStyle: "primary",
    supportRoleId: "role-1",
    channelNamePrefix: "appeal",
    questions: [
      {
        id: "reason",
        label: "Why are you opening this ticket?",
        style: "paragraph",
        placeholder: "Explain the issue",
        required: true,
      },
    ],
  });

  assert.equal(response.type, 9);
  assert.equal(response.data.custom_id, buildTicketOpenCustomId("appeals"));
  assert.equal(response.data.components[0].components[0].custom_id, "reason");
});

test("parseTicketCustomId distinguishes open and close actions", () => {
  assert.deepEqual(parseTicketCustomId(buildTicketOpenCustomId("appeals")), {
    action: "open",
    ticketTypeId: "appeals",
  });
  assert.deepEqual(parseTicketCustomId(buildTicketCloseCustomId("ticket-channel-1")), {
    action: "close",
    channelId: "ticket-channel-1",
  });
});

test("renderTicketTranscript includes answers and chat history", () => {
  const output = renderTicketTranscript(
    {
      guildId: "guild-1",
      channelId: "ticket-channel-1",
      ticketTypeId: "appeals",
      ticketTypeLabel: "Appeal",
      openerUserId: "user-1",
      supportRoleId: "role-1",
      status: "open",
      answers: [
        { questionId: "reason", label: "Why are you opening this ticket?", value: "Need help" },
      ],
      openedAtMs: 1_000,
      closedAtMs: 2_000,
      closedByUserId: "user-2",
      transcriptMessageId: null,
    },
    [
      {
        id: "m1",
        authorName: "User One",
        content: "Need help",
        createdAt: "2026-04-17T22:00:00.000Z",
      },
      {
        id: "m2",
        authorName: "Support",
        content: "We are reviewing this",
        createdAt: "2026-04-17T22:01:00.000Z",
      },
    ],
  );

  assert.match(output, /Ticket Type: Appeal/);
  assert.match(output, /Why are you opening this ticket\?: Need help/);
  assert.match(output, /\[2026-04-17T22:01:00.000Z\] Support: We are reviewing this/);
});
```

```ts
// test/discord.test.ts
test("createTicketChannel posts a private guild channel with opener and support overwrites", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json({ id: "ticket-channel-1" });
  }) as typeof fetch;

  try {
    await createTicketChannel(
      {
        guildId: "guild-1",
        name: "appeal-user-1",
        parentId: "category-1",
        openerUserId: "user-1",
        supportRoleId: "role-1",
      },
      "bot-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://discord.com/api/v10/guilds/guild-1/channels",
      method: "POST",
      body: {
        name: "appeal-user-1",
        type: 0,
        parent_id: "category-1",
        permission_overwrites: [
          { id: "guild-1", type: 0, deny: "1024", allow: "0" },
          { id: "user-1", type: 1, allow: "1024", deny: "0" },
          { id: "role-1", type: 0, allow: "1024", deny: "0" },
        ],
      },
    },
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/tickets.test.js dist-tests/test/discord.test.js`  
Expected: FAIL with missing module errors for `src/tickets.ts` and missing exported Discord ticket helper functions.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tickets.ts
import type { TicketInstance, TicketTypeConfig } from "./types";

export interface TranscriptMessage {
  id: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export function buildTicketOpenCustomId(ticketTypeId: string): string {
  return `ticket:open:${ticketTypeId}`;
}

export function buildTicketCloseCustomId(channelId: string): string {
  return `ticket:close:${channelId}`;
}

export function parseTicketCustomId(
  customId: string,
): { action: "open"; ticketTypeId: string } | { action: "close"; channelId: string } | null {
  if (customId.startsWith("ticket:open:")) {
    return { action: "open", ticketTypeId: customId.slice("ticket:open:".length) };
  }
  if (customId.startsWith("ticket:close:")) {
    return { action: "close", channelId: customId.slice("ticket:close:".length) };
  }
  return null;
}

export function buildTicketModalResponse(ticketType: TicketTypeConfig) {
  return {
    type: 9,
    data: {
      custom_id: buildTicketOpenCustomId(ticketType.id),
      title: `${ticketType.label} Ticket`,
      components: ticketType.questions.map((question) => ({
        type: 1,
        components: [
          {
            type: 4,
            custom_id: question.id,
            label: question.label,
            style: question.style === "paragraph" ? 2 : 1,
            placeholder: question.placeholder,
            required: question.required,
          },
        ],
      })),
    },
  };
}

export function buildTicketChannelName(prefix: string, openerUserId: string): string {
  return `${prefix}-${openerUserId}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 90);
}

export function extractTicketAnswersFromModal(
  interaction: {
    data?: { components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }> };
  },
  questions: TicketTypeConfig["questions"],
) {
  const values = new Map<string, string>();
  for (const row of interaction.data?.components ?? []) {
    for (const component of row.components ?? []) {
      if (typeof component.custom_id === "string" && typeof component.value === "string") {
        values.set(component.custom_id, component.value);
      }
    }
  }

  return questions.map((question) => ({
    questionId: question.id,
    label: question.label,
    value: values.get(question.id) ?? "",
  }));
}

export function renderTicketTranscript(
  instance: TicketInstance,
  messages: TranscriptMessage[],
): string {
  const answerLines = instance.answers.map((answer) => `${answer.label}: ${answer.value}`);
  const messageLines = messages.map(
    (message) => `[${message.createdAt}] ${message.authorName}: ${message.content}`,
  );

  return [
    `Guild: ${instance.guildId}`,
    `Channel: ${instance.channelId}`,
    `Ticket Type: ${instance.ticketTypeLabel}`,
    `Opened By: ${instance.openerUserId}`,
    `Closed By: ${instance.closedByUserId ?? "n/a"}`,
    "",
    "Answers:",
    ...answerLines,
    "",
    "Messages:",
    ...messageLines,
  ].join("\n");
}
```

```ts
// src/discord.ts
export interface TicketChannelCreateInput {
  guildId: string;
  name: string;
  parentId: string;
  openerUserId: string;
  supportRoleId: string;
}

export async function createTicketChannel(
  input: TicketChannelCreateInput,
  botToken: string,
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/guilds/${input.guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      type: 0,
      parent_id: input.parentId,
      permission_overwrites: [
        { id: input.guildId, type: 0, deny: "1024", allow: "0" },
        { id: input.openerUserId, type: 1, allow: "1024", deny: "0" },
        { id: input.supportRoleId, type: 0, allow: "1024", deny: "0" },
      ],
    }),
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Failed to create ticket channel: ${response.status} ${error}`,
      response.status,
      error,
    );
  }
  return response.json();
}

export async function listGuildTicketResources(guildId: string, botToken: string) {
  const [rolesResponse, channelsResponse] = await Promise.all([
    fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    }),
    fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
      headers: { Authorization: `Bot ${botToken}` },
    }),
  ]);
  return { roles: await rolesResponse.json(), channels: await channelsResponse.json() };
}

export async function createChannelMessage(
  channelId: string,
  body: Record<string, unknown>,
  botToken: string,
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Failed to create channel message: ${response.status} ${error}`,
      response.status,
      error,
    );
  }
  return response.json();
}

export async function listChannelMessages(channelId: string, botToken: string) {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=100`, {
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Failed to list channel messages: ${response.status} ${error}`,
      response.status,
      error,
    );
  }
  return response.json();
}

export async function deleteChannel(channelId: string, botToken: string): Promise<void> {
  const response = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Failed to delete ticket channel: ${response.status} ${error}`,
      response.status,
      error,
    );
  }
}

export async function uploadTranscriptToChannel(
  channelId: string,
  filename: string,
  transcriptBody: string,
  botToken: string,
): Promise<{ id: string }> {
  const formData = new FormData();
  formData.set("payload_json", JSON.stringify({ content: `Transcript saved: ${filename}` }));
  formData.set("files[0]", new File([transcriptBody], filename, { type: "text/plain" }));

  const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
    },
    body: formData,
  });
  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Failed to upload transcript: ${response.status} ${error}`,
      response.status,
      error,
    );
  }
  return response.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/tickets.test.js dist-tests/test/discord.test.js`  
Expected: PASS for ticket helper rendering/parsing and Discord ticket-channel request-shape tests.

- [ ] **Step 5: Commit**

```bash
git add src/tickets.ts src/discord.ts test/tickets.test.ts test/discord.test.ts
git commit -m "feat: add ticket helper module" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Wire ticket admin APIs and Discord lifecycle into the runtime app

**Files:**

- Modify: `src/runtime/app.ts`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp exposes ticket admin APIs through session auth", async () => {
  const savedPanels: TicketPanelConfig[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readTicketPanelConfig(guildId: string) {
        return savedPanels.find((panel) => panel.guildId === guildId) ?? null;
      },
      async upsertTicketPanelConfig(panel: TicketPanelConfig) {
        savedPanels.push(panel);
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const cookie = await createAdminSessionCookie("session-secret");
  const saveResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/tickets/panel", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        guildId: "guild-1",
        panelChannelId: "panel-channel-1",
        categoryChannelId: "category-1",
        transcriptChannelId: "transcript-1",
        panelMessageId: null,
        ticketTypes: [],
      }),
    }),
  );
  assert.equal(saveResponse.status, 200);

  const readResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/tickets/panel?guildId=guild-1", {
      headers: { cookie },
    }),
  );
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).guildId, "guild-1");
});

test("createRuntimeApp opens and closes a ticket from component and modal interactions", async () => {
  const calls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"}:${String(input)}`);
    if (String(input).includes("/guilds/guild-1/channels")) {
      return Response.json({ id: "ticket-channel-1" });
    }
    if (
      String(input).includes("/channels/ticket-channel-1/messages") &&
      (init?.method ?? "GET") === "GET"
    ) {
      return Response.json([
        {
          id: "m1",
          content: "Need help",
          timestamp: "2026-04-17T22:00:00.000Z",
          author: { username: "User One" },
        },
      ]);
    }
    return Response.json({ id: "message-1" });
  }) as typeof fetch;

  try {
    const panel: TicketPanelConfig = {
      guildId: "guild-1",
      panelChannelId: "panel-channel-1",
      categoryChannelId: "category-1",
      transcriptChannelId: "transcript-1",
      panelMessageId: "panel-message-1",
      ticketTypes: [
        {
          id: "appeals",
          label: "Appeal",
          emoji: "🧾",
          buttonStyle: "primary",
          supportRoleId: "role-1",
          channelNamePrefix: "appeal",
          questions: [
            {
              id: "reason",
              label: "Why are you opening this ticket?",
              style: "paragraph",
              placeholder: "Explain",
              required: true,
            },
          ],
        },
      ],
    };

    let openInstance: TicketInstance | null = null;
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      verifyDiscordRequest: async () => true,
      store: {
        async readTicketPanelConfig() {
          return panel;
        },
        async createTicketInstance(instance: TicketInstance) {
          openInstance = instance;
        },
        async readOpenTicketByChannel() {
          return openInstance;
        },
        async closeTicketInstance() {
          openInstance = null;
        },
      } as unknown as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const openResponse = await app.fetch(
      new Request("https://runtime.example/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature-ed25519": "ignored",
          "x-signature-timestamp": String(Math.floor(Date.now() / 1000)),
        },
        body: JSON.stringify({
          type: 3,
          guild_id: "guild-1",
          channel_id: "panel-channel-1",
          data: { custom_id: "ticket:open:appeals" },
          member: { user: { id: "user-1" } },
        }),
      }),
    );
    assert.equal((await openResponse.json()).type, 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`  
Expected: FAIL with `404` on `/admin/api/tickets/*` routes and unhandled Discord interaction types `3` or `5`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/app.ts
function parseTicketPanelConfigMutation(body: unknown): TicketPanelConfigMutation {
  if (
    !isRecord(body) ||
    typeof body.guildId !== "string" ||
    typeof body.panelChannelId !== "string" ||
    typeof body.categoryChannelId !== "string" ||
    typeof body.transcriptChannelId !== "string" ||
    !Array.isArray(body.ticketTypes)
  ) {
    throw new AdminApiInputError("Missing ticket panel fields");
  }

  return {
    guildId: body.guildId,
    panelChannelId: body.panelChannelId,
    categoryChannelId: body.categoryChannelId,
    transcriptChannelId: body.transcriptChannelId,
    panelMessageId: typeof body.panelMessageId === "string" ? body.panelMessageId : null,
    ticketTypes: body.ticketTypes as TicketPanelConfigMutation["ticketTypes"],
  };
}

function parseTicketPanelPublishMutation(body: unknown): TicketPanelPublishMutation {
  if (!isRecord(body) || typeof body.guildId !== "string" || body.guildId.length === 0) {
    throw new AdminApiInputError("Missing guildId for ticket panel publish");
  }
  return { guildId: body.guildId };
}

async function publishTicketPanel(guildId: string, options: RuntimeAppOptions) {
  const panel = await options.store.readTicketPanelConfig(guildId);
  if (!panel) {
    throw new AdminApiInputError("Ticket panel is not configured for this guild");
  }

  const message = await createChannelMessage(
    panel.panelChannelId,
    {
      content: "Open a ticket using one of the buttons below.",
      components: [
        {
          type: 1,
          components: panel.ticketTypes.map((ticketType) => ({
            type: 2,
            style:
              ticketType.buttonStyle === "primary"
                ? 1
                : ticketType.buttonStyle === "secondary"
                  ? 2
                  : ticketType.buttonStyle === "success"
                    ? 3
                    : 4,
            custom_id: buildTicketOpenCustomId(ticketType.id),
            label: ticketType.label,
            emoji: ticketType.emoji ? { name: ticketType.emoji } : undefined,
          })),
        },
      ],
    },
    options.discordBotToken,
  );

  await options.store.upsertTicketPanelConfig({ ...panel, panelMessageId: message.id });
  return { ...panel, panelMessageId: message.id };
}

if (request.method === "GET" && url.pathname === "/admin/api/tickets/panel") {
  const guildId = url.searchParams.get("guildId");
  if (!guildId) {
    return Response.json({ error: "guildId is required" }, { status: 400 });
  }
  return Response.json(await options.store.readTicketPanelConfig(guildId));
}

if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel") {
  const parsedBody = await parseJsonBody(request, parseTicketPanelConfigMutation);
  if (!parsedBody.ok) return parsedBody.response;
  await options.store.upsertTicketPanelConfig(parsedBody.value);
  return Response.json(parsedBody.value);
}

if (request.method === "GET" && url.pathname === "/admin/api/tickets/resources") {
  const guildId = url.searchParams.get("guildId");
  if (!guildId) {
    return Response.json({ error: "guildId is required" }, { status: 400 });
  }
  const { roles, channels } = await listGuildTicketResources(guildId, options.discordBotToken);
  return Response.json({
    guildId,
    roles: roles.map((role: { id: string; name: string }) => ({ id: role.id, name: role.name })),
    categories: channels
      .filter((channel: { id: string; name: string; type: number }) => channel.type === 4)
      .map((channel: { id: string; name: string }) => ({ id: channel.id, name: channel.name })),
    textChannels: channels
      .filter((channel: { id: string; name: string; type: number }) => channel.type === 0)
      .map((channel: { id: string; name: string }) => ({ id: channel.id, name: channel.name })),
  });
}

if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel/publish") {
  const parsedBody = await parseJsonBody(request, parseTicketPanelPublishMutation);
  if (!parsedBody.ok) return parsedBody.response;
  return Response.json(await publishTicketPanel(parsedBody.value.guildId, options));
}

if (request.method === "POST" && url.pathname === "/interactions") {
  return handleInteractionRequest(request, options);
}
```

```ts
// src/runtime/app.ts
async function handleInteractionRequest(
  request: Request,
  options: RuntimeAppOptions,
): Promise<Response> {
  // existing signature verification and PING handling...
  const interaction = (await request.json()) as DiscordInteraction;

  if (interaction.type === 3) {
    const parsed = parseTicketCustomId(
      String((interaction.data as { custom_id?: string })?.custom_id ?? ""),
    );
    if (!parsed) {
      return Response.json(buildEphemeralMessage("Unsupported button action."), { status: 200 });
    }
    if (parsed.action === "open") {
      const panel = await options.store.readTicketPanelConfig(interaction.guild_id!);
      const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsed.ticketTypeId);
      if (!ticketType) {
        return Response.json(buildEphemeralMessage("This ticket button is no longer configured."), {
          status: 200,
        });
      }
      return Response.json(buildTicketModalResponse(ticketType));
    }
    return Response.json(await closeTicketFromInteraction(interaction, parsed.channelId, options));
  }

  if (interaction.type === 5) {
    return Response.json(await createTicketFromModal(interaction, options));
  }

  // existing slash-command handling...
}
```

```ts
// src/runtime/app.ts
async function createTicketFromModal(interaction: DiscordInteraction, options: RuntimeAppOptions) {
  const panel = await options.store.readTicketPanelConfig(interaction.guild_id!);
  const modalCustomId = String((interaction.data as { custom_id?: string })?.custom_id ?? "");
  const modalTicketAction = parseTicketCustomId(modalCustomId);
  const ticketType =
    modalTicketAction?.action === "open"
      ? panel?.ticketTypes.find((entry) => entry.id === modalTicketAction.ticketTypeId)
      : null;
  if (!panel || !ticketType) {
    return buildEphemeralMessage("This ticket configuration is no longer available.");
  }

  const channel = await createTicketChannel(
    {
      guildId: interaction.guild_id!,
      name: buildTicketChannelName(ticketType.channelNamePrefix, interaction.member!.user!.id),
      parentId: panel.categoryChannelId,
      openerUserId: interaction.member!.user!.id,
      supportRoleId: ticketType.supportRoleId,
    },
    options.discordBotToken,
  );

  const answers = extractTicketAnswersFromModal(interaction, ticketType.questions);
  await options.store.createTicketInstance({
    guildId: interaction.guild_id!,
    channelId: channel.id,
    ticketTypeId: ticketType.id,
    ticketTypeLabel: ticketType.label,
    openerUserId: interaction.member!.user!.id,
    supportRoleId: ticketType.supportRoleId,
    status: "open",
    answers,
    openedAtMs: Date.now(),
    closedAtMs: null,
    closedByUserId: null,
    transcriptMessageId: null,
  });

  await createChannelMessage(
    channel.id,
    {
      content: [
        `Ticket Type: ${ticketType.label}`,
        ...answers.map((answer) => `${answer.label}: ${answer.value}`),
      ].join("\n"),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 4,
              custom_id: buildTicketCloseCustomId(channel.id),
              label: "Close Ticket",
            },
          ],
        },
      ],
    },
    options.discordBotToken,
  );
  return buildEphemeralMessage(`Ticket created: <#${channel.id}>`);
}

async function closeTicketFromInteraction(
  interaction: DiscordInteraction,
  channelId: string,
  options: RuntimeAppOptions,
) {
  const ticket = await options.store.readOpenTicketByChannel(interaction.guild_id!, channelId);
  if (!ticket) {
    return buildEphemeralMessage("This ticket is already closed.");
  }

  const actorId = interaction.member!.user!.id;
  const actorRoleIds = new Set((interaction.member!.roles ?? []) as string[]);
  if (actorId !== ticket.openerUserId && !actorRoleIds.has(ticket.supportRoleId)) {
    return buildEphemeralMessage("Only the ticket opener or support role can close this ticket.");
  }

  const discordMessages = await listChannelMessages(channelId, options.discordBotToken);
  const transcriptBody = renderTicketTranscript(
    ticket,
    discordMessages
      .slice()
      .reverse()
      .map(
        (message: {
          id: string;
          content: string;
          timestamp: string;
          author: { username: string };
        }) => ({
          id: message.id,
          authorName: message.author.username,
          content: message.content,
          createdAt: message.timestamp,
        }),
      ),
  );

  const panel = await options.store.readTicketPanelConfig(interaction.guild_id!);
  const transcriptMessage = await uploadTranscriptToChannel(
    panel!.transcriptChannelId,
    `${ticket.channelId}.txt`,
    transcriptBody,
    options.discordBotToken,
  );

  await options.store.closeTicketInstance({
    guildId: interaction.guild_id!,
    channelId,
    closedByUserId: actorId,
    closedAtMs: Date.now(),
    transcriptMessageId: transcriptMessage.id,
  });

  await deleteChannel(channelId, options.discordBotToken);
  return buildEphemeralMessage("Ticket closed and transcript saved.");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`  
Expected: PASS for the new session-protected ticket admin route coverage and runtime-level ticket interaction flow.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app.ts test/runtime-app.test.ts
git commit -m "feat: wire ticket lifecycle into runtime app" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Build the admin ticket panel editor with friendly Discord names

**Files:**

- Create: `src/admin/components/ticket-panel-editor.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// test/admin-app.test.tsx
import { renderToString } from "react-dom/server";

import App from "../src/admin/App";
import { TicketPanelEditor } from "../src/admin/components/ticket-panel-editor";

test("authenticated admin dashboard renders the ticketing section", () => {
  const html = renderToString(<App initialAuthenticated />);
  assert.match(html, /Ticket Panels/i);
  assert.match(html, /Configure ticket buttons, questions, and transcript routing/i);
});

test("ticket panel editor shows friendly Discord names instead of raw IDs", () => {
  const html = renderToString(
    <TicketPanelEditor
      guildResources={{
        guildId: "guild-1",
        roles: [{ id: "role-1", name: "Support" }],
        categories: [{ id: "category-1", name: "Open Tickets" }],
        textChannels: [{ id: "transcript-1", name: "ticket-transcripts" }],
      }}
      value={{
        guildId: "guild-1",
        panelChannelId: "panel-channel-1",
        categoryChannelId: "category-1",
        transcriptChannelId: "transcript-1",
        panelMessageId: null,
        ticketTypes: [],
      }}
      onChange={() => {}}
      onSave={async () => {}}
      onPublish={async () => {}}
    />,
  );

  assert.match(html, />Support</);
  assert.match(html, />Open Tickets</);
  assert.match(html, />ticket-transcripts</);
  assert.doesNotMatch(html, />role-1</);
  assert.doesNotMatch(html, />category-1</);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js`  
Expected: FAIL with missing `TicketPanelEditor` export or missing `Ticket Panels` dashboard section.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/ticket-panel-editor.tsx
import type { GuildTicketResources } from "../../runtime/admin-types";
import type { TicketPanelConfig } from "../../types";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface TicketPanelEditorProps {
  guildResources: GuildTicketResources | null;
  value: TicketPanelConfig;
  onChange(nextValue: TicketPanelConfig): void;
  onSave(): Promise<void>;
  onPublish(): Promise<void>;
}

export function TicketPanelEditor(props: TicketPanelEditorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket Panels</CardTitle>
        <p className="text-sm text-muted-foreground">
          Configure ticket buttons, questions, and transcript routing.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ticket-category">Ticket category</Label>
          <select
            id="ticket-category"
            value={props.value.categoryChannelId}
            onChange={() => undefined}
          >
            {props.guildResources?.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ticket-transcripts">Transcript channel</Label>
          <select
            id="ticket-transcripts"
            value={props.value.transcriptChannelId}
            onChange={() => undefined}
          >
            {props.guildResources?.textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ticket-role">Support role</Label>
          <select
            id="ticket-role"
            value={props.value.ticketTypes[0]?.supportRoleId ?? ""}
            onChange={() => undefined}
          >
            {props.guildResources?.roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void props.onSave()}>Save ticket panel</Button>
          <Button variant="outline" onClick={() => void props.onPublish()}>
            Publish panel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

```tsx
// src/admin/App.tsx
import { TicketPanelEditor } from "./components/ticket-panel-editor";

// inside the authenticated dashboard layout
<section className="space-y-4">
  <SectionHeading
    title="Ticket Panels"
    description="Configure ticket buttons, questions, and transcript routing."
  />
  <TicketPanelEditor
    guildResources={ticketResources}
    value={ticketPanel}
    onChange={setTicketPanel}
    onSave={saveTicketPanel}
    onPublish={publishTicketPanel}
  />
</section>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js`  
Expected: PASS for the dashboard ticket section and friendly-name selector coverage.

- [ ] **Step 5: Commit**

```bash
git add src/admin/App.tsx src/admin/components/ticket-panel-editor.tsx test/admin-app.test.tsx
git commit -m "feat: add admin ticket panel editor" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Add Worker-level ticket route coverage and document operator setup

**Files:**

- Modify: `test/interaction-routes.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

```ts
// test/interaction-routes.test.ts
test("worker returns a ticket modal for a signed open-ticket button click", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest({
    type: 3,
    guild_id: "guild-1",
    channel_id: "panel-channel-1",
    data: { custom_id: "ticket:open:appeals" },
    member: { user: { id: "user-1" } },
  });

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input) {
        if (String(input).includes("/ticket-panel?guildId=guild-1")) {
          return Response.json({
            guildId: "guild-1",
            panelChannelId: "panel-channel-1",
            categoryChannelId: "category-1",
            transcriptChannelId: "transcript-1",
            panelMessageId: "panel-message-1",
            ticketTypes: [
              {
                id: "appeals",
                label: "Appeal",
                emoji: "🧾",
                buttonStyle: "primary",
                supportRoleId: "role-1",
                channelNamePrefix: "appeal",
                questions: [
                  {
                    id: "reason",
                    label: "Why are you opening this ticket?",
                    style: "paragraph",
                    placeholder: "Explain",
                    required: true,
                  },
                ],
              },
            ],
          });
        }
        return Response.json({ ok: true });
      },
    }),
    {} as ExecutionContext,
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).type, 9);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js`  
Expected: FAIL because the signed Worker interaction route does not yet return ticket modal responses for button interactions.

- [ ] **Step 3: Write minimal implementation**

```md
<!-- README.md -->

## Ticket tool setup

After signing into the admin dashboard, configure one ticket panel per guild:

1. Pick the panel channel where the ticket buttons should be published
2. Pick the shared ticket category for created ticket channels
3. Pick the transcript log channel
4. Add one or more ticket types with a support role and up to five modal questions
5. Publish the panel to Discord from the dashboard

When a user clicks a ticket button, the bot opens the configured modal, creates a private ticket channel for the opener plus the configured support role, and posts the submitted answers into that channel. Closing the ticket from Discord uploads a transcript to the configured log channel and then deletes the ticket channel.

The bot needs permission to:

- View Channels
- Send Messages
- Manage Channels
- Read Message History
- Attach Files
```

- [ ] **Step 4: Run focused and full verification**

Run: `pnpm run build:test && node --test dist-tests/test/interaction-routes.test.js && pnpm test && pnpm run typecheck`  
Expected: PASS for the signed Worker ticket interaction test, then PASS for the full repository test suite and typecheck.

- [ ] **Step 5: Commit**

```bash
git add test/interaction-routes.test.ts README.md
git commit -m "docs: add ticket tool setup" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
