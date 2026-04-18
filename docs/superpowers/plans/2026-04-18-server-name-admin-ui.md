# Server Name Admin UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin dashboard work from server names instead of requiring raw guild IDs while still keeping `guildId` as the internal identifier for storage and Discord API calls.

**Architecture:** Add one authenticated admin route that returns the bot's guild directory from Discord, including duplicate-safe labels. Then move the admin UI onto a shared guild picker and a small overview-card component so selection and display use server names while all existing mutations and queries keep sending `guildId`.

**Tech Stack:** TypeScript, React 18, Cloudflare/Node runtime app, Discord REST API, Node test runner, Vite admin bundle

---

## File Map

- Modify: `src/discord.ts:19-22,39-52,138-150,361-380` — add a Discord helper for listing the bot's guilds.
- Modify: `src/runtime/admin-types.ts:1-21` — add shared admin guild-directory payload types.
- Modify: `src/runtime/app.ts:10-22,164-230,400-428` — add `GET /admin/api/guilds` and duplicate-safe label shaping.
- Create: `src/admin/components/guild-picker.tsx` — shared guild selector with searchable filtering and manual-ID fallback when guild lookup fails.
- Create: `src/admin/components/guild-overview-card.tsx` — overview card that prefers server names and keeps IDs as secondary metadata.
- Modify: `src/admin/App.tsx:1-20,41-76,145-283,413-826,937-949` — fetch the guild directory after auth, pass it into the editors, and use the extracted overview card.
- Test: `test/runtime-app.test.ts` — cover the new admin guild-directory route and duplicate-name labels.
- Test: `test/admin-app.test.tsx` — cover the guild picker rendering, fallback behavior, and overview labels.

### Task 1: Add the authenticated guild-directory route

**Files:**
- Modify: `src/discord.ts`
- Modify: `src/runtime/admin-types.ts`
- Modify: `src/runtime/app.ts`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test("createRuntimeApp exposes the bot guild directory for the admin UI", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (url.endsWith("/users/@me/guilds")) {
      return Response.json([
        { id: "guild-2", name: "Alpha" },
        { id: "guild-3", name: "Alpha" },
        { id: "guild-1", name: "Bravo" },
      ]);
    }

    throw new Error(`Unexpected Discord call: ${url}`);
  }) as typeof fetch;

  try {
    const app = createRuntimeApp({
      discordPublicKey: "a".repeat(64),
      discordBotToken: "bot-token",
      adminUiPassword: "let-me-in",
      adminSessionSecret: "session-secret",
      verifyDiscordRequest: async () => true,
      store: {} as RuntimeStore,
      gateway: {} as GatewayController,
    });

    const cookie = await createAdminSessionCookie("session-secret");
    const response = await app.fetch(
      new Request("https://runtime.example/admin/api/guilds", {
        headers: { cookie },
      })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      guilds: [
        { guildId: "guild-2", name: "Alpha", label: "Alpha (guild-2)" },
        { guildId: "guild-3", name: "Alpha", label: "Alpha (guild-3)" },
        { guildId: "guild-1", name: "Bravo", label: "Bravo" },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js --test-name-pattern "guild directory"`
Expected: FAIL with a `404 !== 200` assertion because `/admin/api/guilds` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/admin-types.ts
export interface AdminGuildDirectoryEntry {
  guildId: string;
  name: string;
  label: string;
}

export interface AdminGuildDirectoryResponse {
  guilds: AdminGuildDirectoryEntry[];
}
```

```ts
// src/discord.ts
export interface DiscordCurrentUserGuild {
  id: string;
  name: string;
}

export async function listBotGuilds(
  botToken: string
): Promise<Array<{ guildId: string; name: string }>> {
  const guilds = await discordGetJson<DiscordCurrentUserGuild[]>(
    `${DISCORD_API}/users/@me/guilds`,
    botToken
  );

  return guilds.map(({ id, name }) => ({
    guildId: id,
    name,
  }));
}
```

```ts
// src/runtime/app.ts
import {
  addGuildMemberRole,
  createTicketChannel,
  deleteChannel,
  DiscordApiError,
  listBotGuilds,
  listChannelMessages,
  listGuildTicketResources,
  removeGuildMemberRole,
  syncApplicationCommands,
  uploadTranscriptToChannel,
  verifyDiscordSignature,
} from "../discord";
import type {
  AdminGuildDirectoryEntry,
  AdminGuildDirectoryResponse,
  AppConfigMutation,
} from "./admin-types";

if (request.method === "GET" && url.pathname === "/admin/api/guilds") {
  const guilds = buildAdminGuildDirectory(await listBotGuilds(options.discordBotToken));
  const body: AdminGuildDirectoryResponse = { guilds };
  return Response.json(body);
}

function buildAdminGuildDirectory(
  guilds: Array<{ guildId: string; name: string }>
): AdminGuildDirectoryEntry[] {
  const nameCounts = new Map<string, number>();

  for (const guild of guilds) {
    nameCounts.set(guild.name, (nameCounts.get(guild.name) ?? 0) + 1);
  }

  return [...guilds]
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.guildId.localeCompare(right.guildId)
    )
    .map((guild) => ({
      guildId: guild.guildId,
      name: guild.name,
      label:
        (nameCounts.get(guild.name) ?? 0) > 1
          ? `${guild.name} (${guild.guildId})`
          : guild.name,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js --test-name-pattern "guild directory"`
Expected: PASS for the new guild-directory route test.

- [ ] **Step 5: Commit**

```bash
git add src/discord.ts src/runtime/admin-types.ts src/runtime/app.ts test/runtime-app.test.ts
git commit -m "feat: add admin guild directory route"
```

### Task 2: Build the shared guild picker and wire the editors to it

**Files:**
- Create: `src/admin/components/guild-picker.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
import type { AdminGuildDirectoryEntry } from "../src/runtime/admin-types";
import { GuildPicker } from "../src/admin/components/guild-picker";

const guildDirectory: AdminGuildDirectoryEntry[] = [
  { guildId: "guild-1", name: "Alpha", label: "Alpha" },
  { guildId: "guild-2", name: "Bravo", label: "Bravo" },
];

test("authenticated admin dashboard labels guild workflows as server controls", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Blocklist/i);
  assert.match(html, /Timed Roles/i);
  assert.match(html, /Ticket Panels/i);
  assert.match(html, /Server/);
  assert.doesNotMatch(html, /Guild ID/);
});

test("guild picker renders searchable server labels from the guild directory", () => {
  const html = renderToString(
    <GuildPicker
      id="guild-picker"
      value="guild-2"
      guildDirectory={guildDirectory}
      loadError={null}
      onChange={() => {}}
    />
  );

  assert.match(html, /Filter servers/);
  assert.match(html, />Alpha</);
  assert.match(html, />Bravo</);
});

test("guild picker falls back to a raw guild ID input when lookup fails", () => {
  const html = renderToString(
    <GuildPicker
      id="guild-picker"
      value="guild-2"
      guildDirectory={null}
      loadError="Discord lookup failed"
      onChange={() => {}}
    />
  );

  assert.match(html, /Guild ID/);
  assert.match(html, /Discord lookup failed/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "server controls|guild picker"`
Expected: FAIL because `GuildPicker` does not exist and the dashboard still renders `Guild ID` labels.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/guild-picker.tsx
import { useMemo, useState } from "react";

import type { AdminGuildDirectoryEntry } from "../../runtime/admin-types";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

interface GuildPickerProps {
  id: string;
  value: string;
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  loadError: string | null;
  onChange: (nextGuildId: string) => void;
}

export function GuildPicker({
  id,
  value,
  guildDirectory,
  loadError,
  onChange,
}: GuildPickerProps) {
  const [query, setQuery] = useState("");

  const filteredGuilds = useMemo(() => {
    if (!guildDirectory) {
      return [];
    }

    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return guildDirectory;
    }

    return guildDirectory.filter((guild) =>
      guild.label.toLowerCase().includes(normalizedQuery)
    );
  }, [guildDirectory, query]);

  if (loadError) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>Guild ID</Label>
        <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} />
        <p className="text-xs text-muted-foreground">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-query`}>Server</Label>
        <Input
          id={`${id}-query`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter servers"
          disabled={!guildDirectory}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={id}>Server</Label>
        <select
          id={id}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={!guildDirectory}
        >
          <option value="">
            {guildDirectory ? "— select a server —" : "Loading servers…"}
          </option>
          {filteredGuilds.map((guild) => (
            <option key={guild.guildId} value={guild.guildId}>
              {guild.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
```

```tsx
// src/admin/App.tsx
import type {
  AdminGuildDirectoryEntry,
  AdminGuildDirectoryResponse,
} from "../runtime/admin-types";
import { GuildPicker } from "./components/guild-picker";

interface GuildSelectionProps {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}

const [guildDirectory, setGuildDirectory] =
  useState<AdminGuildDirectoryEntry[] | null>(null);
const [guildLookupError, setGuildLookupError] = useState<string | null>(null);

useEffect(() => {
  if (!authenticated) {
    setGuildDirectory(null);
    setGuildLookupError(null);
    return;
  }

  let cancelled = false;

  void (async () => {
    try {
      const response = await readJsonOrThrow<AdminGuildDirectoryResponse>(
        "/admin/api/guilds"
      );

      if (!cancelled) {
        setGuildDirectory(response.guilds);
        setGuildLookupError(null);
      }
    } catch (error) {
      if (!cancelled) {
        setGuildDirectory(null);
        setGuildLookupError(describeError(error));
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}, [authenticated]);

<BlocklistEditor
  guildDirectory={guildDirectory}
  guildLookupError={guildLookupError}
  onUpdated={loadOverview}
/>
<TimedRolesEditor
  guildDirectory={guildDirectory}
  guildLookupError={guildLookupError}
  onUpdated={loadOverview}
/>
<TicketPanelsEditor
  guildDirectory={guildDirectory}
  guildLookupError={guildLookupError}
/>
```

```tsx
// src/admin/App.tsx
function BlocklistEditor({
  guildDirectory,
  guildLookupError,
  onUpdated,
}: GuildSelectionProps & { onUpdated: () => Promise<void> }) {
  return (
    <div className="space-y-4">
      <EditorPanel>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(14rem,0.95fr)]">
          <GuildPicker
            id="bl-guild"
            value={guildId}
            guildDirectory={guildDirectory}
            loadError={guildLookupError}
            onChange={(nextGuildId) => {
              setGuildId(nextGuildId);
              setCurrentEmojis(null);
            }}
          />
          <FormField label="Emoji" htmlFor="bl-emoji">
            <Input id="bl-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
          </FormField>
          {/* existing action toggle */}
        </div>
      </EditorPanel>
    </div>
  );
}

function TimedRolesEditor({
  guildDirectory,
  guildLookupError,
  onUpdated,
}: GuildSelectionProps & { onUpdated: () => Promise<void> }) {
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
            <Input id="tr-user" value={userId} onChange={(e) => setUserId(e.target.value)} />
          </FormField>
          <FormField label="Role ID" htmlFor="tr-role">
            <Input id="tr-role" value={roleId} onChange={(e) => setRoleId(e.target.value)} />
          </FormField>
          <FormField label="Duration" htmlFor="tr-duration">
            <Input id="tr-duration" value={duration} onChange={(e) => setDuration(e.target.value)} />
          </FormField>
        </div>
      </EditorPanel>
    </div>
  );
}

function TicketPanelsEditor({
  guildDirectory,
  guildLookupError,
}: GuildSelectionProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">
        <GuildPicker
          id="tp-guild"
          value={guildId}
          guildDirectory={guildDirectory}
          loadError={guildLookupError}
          onChange={(nextGuildId) => {
            setGuildId(nextGuildId);
            setGuildResources(null);
            setPanelConfig(null);
          }}
        />
        <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[14rem]"
            disabled={!trimmedGuildId || loading}
            onClick={() => void loadResources(guildId)}
          >
            {loading ? "Loading…" : "Load ticket panel"}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "server controls|guild picker"`
Expected: PASS for the new server-label and guild-picker tests.

- [ ] **Step 5: Commit**

```bash
git add src/admin/App.tsx src/admin/components/guild-picker.tsx test/admin-app.test.tsx
git commit -m "feat: add admin guild picker"
```

### Task 3: Show server names in the stored overview cards

**Files:**
- Create: `src/admin/components/guild-overview-card.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
import {
  GuildOverviewCard,
  type AdminOverviewGuild,
} from "../src/admin/components/guild-overview-card";

const overviewGuild: AdminOverviewGuild = {
  guildId: "guild-1",
  emojis: ["✅"],
  timedRoles: [],
};

test("guild overview card prefers the server name and keeps the guild ID secondary", () => {
  const html = renderToString(
    <GuildOverviewCard guild={overviewGuild} guildName="Alpha" />
  );

  assert.match(html, />Alpha</);
  assert.match(html, /guild-1/);
  assert.doesNotMatch(html, /<h3 class="mt-2 text-lg font-semibold tracking-tight">guild-1<\/h3>/);
});

test("guild overview card falls back to the raw guild ID when no server name is available", () => {
  const html = renderToString(
    <GuildOverviewCard guild={overviewGuild} guildName={null} />
  );

  assert.match(html, />guild-1</);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "overview card"`
Expected: FAIL because `GuildOverviewCard` is still embedded in `App.tsx` and only renders the raw `guildId`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/guild-overview-card.tsx
import type { TimedRoleAssignment } from "../../types";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
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
                <TableCell>{assignment.userId}</TableCell>
                <TableCell>{assignment.roleId}</TableCell>
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
```

```tsx
// src/admin/App.tsx
import {
  GuildOverviewCard,
  type AdminOverviewGuild,
} from "./components/guild-overview-card";

const guildNamesById = new Map(
  (guildDirectory ?? []).map((guild) => [guild.guildId, guild.name] as const)
);

{overview.guilds.map((guild) => (
  <GuildOverviewCard
    key={guild.guildId}
    guild={guild}
    guildName={guildNamesById.get(guild.guildId) ?? null}
  />
))}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "overview card"`
Expected: PASS for the new overview-card tests.

- [ ] **Step 5: Commit**

```bash
git add src/admin/App.tsx src/admin/components/guild-overview-card.tsx test/admin-app.test.tsx
git commit -m "feat: show server names in admin overview"
```

## Final verification

Run the full repository checks after Task 3:

```bash
pnpm test
pnpm run typecheck
```
