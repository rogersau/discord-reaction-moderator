# Admin Dashboard Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single long admin screen with a shadcn-style five-page dashboard shell while preserving the existing admin workflows and runtime contracts.

**Architecture:** Add a shared admin route map so both the runtime and the React app understand `/admin`, `/admin/gateway`, `/admin/blocklist`, `/admin/timed-roles`, and `/admin/tickets`. Then shrink `App.tsx` into an authenticated route-aware coordinator that renders a reusable shell plus focused page components, with page-scoped data loading instead of initializing every workflow at once.

**Tech Stack:** TypeScript, React 18, Tailwind/shadcn primitives, Vite admin bundle, Cloudflare runtime app, Node test runner

---

## File Map

- Create: `src/admin/dashboard-routes.ts` — shared dashboard path constants, labels, and path guards used by both the runtime and React UI.
- Create: `src/admin/components/admin-shell.tsx` — persistent authenticated sidebar shell, nav links, and sign-out control.
- Create: `src/admin/components/admin-page-header.tsx` — shared page title/description block for the five dashboard pages.
- Create: `src/admin/components/admin-overview-page.tsx` — overview landing page with metric cards, quick actions, and stored-server summary.
- Create: `src/admin/components/admin-gateway-page.tsx` — dedicated gateway workspace using the existing gateway details and actions.
- Create: `src/admin/components/admin-form-layout.tsx` — shared editor wrappers (`EditorPanel`, `FormField`, `EditorActions`) for workflow-heavy pages.
- Create: `src/admin/components/admin-blocklist-page.tsx` — blocklist page extracted from the current `App.tsx` editor.
- Create: `src/admin/components/admin-timed-roles-page.tsx` — timed-role page extracted from the current `App.tsx` editor.
- Create: `src/admin/components/admin-tickets-page.tsx` — tickets page that wraps the existing `TicketPanelEditor` workflow.
- Modify: `src/admin/main.tsx` — read the initial dashboard path from the server-rendered root element.
- Modify: `src/admin/App.tsx` — become the authenticated dashboard coordinator instead of the all-in-one page implementation.
- Modify: `src/runtime/app.ts` — serve nested dashboard paths through the same admin shell and inject the initial dashboard path into the HTML root element.
- Modify: `test/runtime-app.test.ts` — cover authenticated and unauthenticated nested dashboard routes.
- Modify: `test/admin-app.test.tsx` — cover shell navigation and per-page rendering for all five dashboard pages.
- Generated: `src/runtime/admin-bundle.ts` — refreshed by `pnpm run build:admin` during final verification.

### Task 1: Add shared dashboard routes and nested runtime shell support

**Files:**

- Create: `src/admin/dashboard-routes.ts`
- Modify: `src/runtime/app.ts`
- Modify: `src/admin/main.tsx`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
test("createRuntimeApp serves authenticated dashboard shells for nested admin pages", async () => {
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
    new Request("https://runtime.example/admin/tickets", {
      headers: { cookie },
    }),
  );

  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /data-authenticated="true"/);
  assert.match(html, /data-initial-path="\/admin\/tickets"/);
});

test("createRuntimeApp redirects unauthenticated nested admin pages to login", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const response = await app.fetch(new Request("https://runtime.example/admin/gateway"));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "/admin/login");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js --test-name-pattern "nested admin pages"`
Expected: FAIL because `createRuntimeApp` only serves `/admin`, so `/admin/tickets` and `/admin/gateway` do not match the authenticated shell route yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/admin/dashboard-routes.ts
export const ADMIN_DASHBOARD_ROUTES = [
  { path: "/admin", label: "Overview" },
  { path: "/admin/gateway", label: "Gateway" },
  { path: "/admin/blocklist", label: "Blocklist" },
  { path: "/admin/timed-roles", label: "Timed Roles" },
  { path: "/admin/tickets", label: "Tickets" },
] as const;

export type AdminDashboardPath = (typeof ADMIN_DASHBOARD_ROUTES)[number]["path"];

export function isAdminDashboardPath(pathname: string): pathname is AdminDashboardPath {
  return ADMIN_DASHBOARD_ROUTES.some((route) => route.path === pathname);
}

export function normalizeAdminDashboardPath(pathname: string): AdminDashboardPath {
  return isAdminDashboardPath(pathname) ? pathname : "/admin";
}
```

```ts
// src/runtime/app.ts
import { isAdminDashboardPath, normalizeAdminDashboardPath } from "../admin/dashboard-routes";

if (request.method === "GET" && isAdminDashboardPath(url.pathname)) {
  if (!(await isAdminUiAuthorized(request, options))) {
    return redirect("/admin/login");
  }

  return renderAdminShell(true, normalizeAdminDashboardPath(url.pathname));
}

function renderAdminShell(authenticated = false, initialPath: string = "/admin"): Response {
  const attributes = [
    authenticated ? 'data-authenticated="true"' : "",
    `data-initial-path="${initialPath}"`,
  ]
    .filter(Boolean)
    .join(" ");

  const html = ADMIN_LOGIN_HTML.replace(
    '<div id="admin-root"></div>',
    `<div id="admin-root" ${attributes}></div>`,
  );

  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
```

```ts
// src/admin/main.tsx
const initialAuthenticated = root.dataset.authenticated === "true";
const initialPath = root.dataset.initialPath ?? "/admin";

createRoot(root).render(
  <StrictMode>
    <App initialAuthenticated={initialAuthenticated} initialPath={initialPath} />
  </StrictMode>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js --test-name-pattern "nested admin pages"`
Expected: PASS for both nested dashboard-route tests.

- [ ] **Step 5: Commit**

```bash
git add src/admin/dashboard-routes.ts src/runtime/app.ts src/admin/main.tsx test/runtime-app.test.ts
git commit -m "feat: add admin dashboard route support" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Build the persistent shell and overview landing page

**Files:**

- Create: `src/admin/components/admin-shell.tsx`
- Create: `src/admin/components/admin-page-header.tsx`
- Create: `src/admin/components/admin-overview-page.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("authenticated admin dashboard renders a sidebar shell with an overview landing page", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin" />);

  assert.match(html, /href="\/admin"/);
  assert.match(html, /href="\/admin\/gateway"/);
  assert.match(html, /href="\/admin\/blocklist"/);
  assert.match(html, /href="\/admin\/timed-roles"/);
  assert.match(html, /href="\/admin\/tickets"/);
  assert.match(html, /aria-current="page"[^>]*>Overview</);
  assert.match(html, /Operational overview/i);
  assert.match(html, /Start gateway/i);
  assert.match(html, /Refresh dashboard/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Load timed roles/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "overview landing page"`
Expected: FAIL because `App` still renders the all-in-one page and has no sidebar shell or overview-only route.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/admin-shell.tsx
import { ADMIN_DASHBOARD_ROUTES, type AdminDashboardPath } from "../dashboard-routes";
import { cn } from "../lib/utils";

export function AdminShell({
  currentPath,
  children,
}: {
  currentPath: AdminDashboardPath;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <aside className="w-full max-w-xs rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Discord Automation
            </p>
            <h1 className="text-lg font-semibold tracking-tight">Admin Dashboard</h1>
          </div>
          <nav className="mt-6 space-y-1" aria-label="Admin">
            {ADMIN_DASHBOARD_ROUTES.map((route) => {
              const active = route.path === currentPath;
              return (
                <a
                  key={route.path}
                  href={route.path}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {route.label}
                </a>
              );
            })}
          </nav>
          <form className="mt-6 border-t pt-4" method="post" action="/admin/logout">
            <button
              className="w-full rounded-md border px-3 py-2 text-sm font-medium"
              type="submit"
            >
              Sign out
            </button>
          </form>
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </main>
  );
}
```

```tsx
// src/admin/components/admin-page-header.tsx
export function AdminPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-1.5">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
```

```tsx
// src/admin/components/admin-overview-page.tsx
export function AdminOverviewPage({
  gatewayStatus,
  overview,
  overviewError,
  guildNamesById,
  onStartGateway,
  onRefresh,
}: {
  gatewayStatus: GatewayStatus | null;
  overview: AdminOverview | null;
  overviewError: string | null;
  guildNamesById: Map<string, string>;
  onStartGateway: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Overview"
        description="Operational overview, gateway health, and quick actions."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Gateway</CardTitle>
          </CardHeader>
          <CardContent>{gatewayStatus?.status ?? "Loading"}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Stored servers</CardTitle>
          </CardHeader>
          <CardContent>{overview ? String(overview.guilds.length) : "-"}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Timed roles</CardTitle>
          </CardHeader>
          <CardContent>
            {overview
              ? String(overview.guilds.reduce((sum, guild) => sum + guild.timedRoles.length, 0))
              : "-"}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={onStartGateway}>Start gateway</Button>
          <Button variant="outline" onClick={onRefresh}>
            Refresh dashboard
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Stored server data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {overviewError ? (
            <Alert variant="destructive">
              <AlertDescription>{overviewError}</AlertDescription>
            </Alert>
          ) : null}
          {overview?.guilds.map((guild) => (
            <GuildOverviewCard
              key={guild.guildId}
              guild={guild}
              guildName={guildNamesById.get(guild.guildId) ?? null}
            />
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
```

```tsx
// src/admin/App.tsx
import { normalizeAdminDashboardPath, type AdminDashboardPath } from "./dashboard-routes";

interface Props {
  initialAuthenticated?: boolean;
  initialPath?: string;
}

const currentPath = normalizeAdminDashboardPath(initialPath ?? "/admin");

if (authenticated) {
  return (
    <AdminShell currentPath={currentPath}>
      <AdminOverviewPage
        gatewayStatus={gatewayStatus}
        overview={overview}
        overviewError={overviewError}
        guildNamesById={guildNamesById}
        onStartGateway={handleGatewayStart}
        onRefresh={loadOverview}
      />
    </AdminShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "overview landing page"`
Expected: PASS for the overview-shell test.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/admin-shell.tsx src/admin/components/admin-page-header.tsx src/admin/components/admin-overview-page.tsx src/admin/App.tsx test/admin-app.test.tsx
git commit -m "feat: add admin shell and overview page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Move gateway controls into a dedicated dashboard page

**Files:**

- Create: `src/admin/components/admin-gateway-page.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("authenticated admin dashboard renders the gateway workspace on /admin/gateway", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin/gateway" />);

  assert.match(html, /aria-current="page"[^>]*>Gateway</);
  assert.match(html, /Start gateway/i);
  assert.match(html, /Refresh dashboard/i);
  assert.match(html, /Current state/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Add timed role/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "gateway workspace"`
Expected: FAIL because `/admin/gateway` still renders the overview page.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/admin-gateway-page.tsx
export function AdminGatewayPage({
  gatewayStatus,
  gatewayError,
  onStartGateway,
  onRefresh,
}: {
  gatewayStatus: GatewayStatus | null;
  gatewayError: string | null;
  onStartGateway: () => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Gateway"
        description="Start the session and inspect live telemetry from the Discord gateway."
      />
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap gap-3">
            <Button onClick={onStartGateway}>Start gateway</Button>
            <Button variant="outline" onClick={onRefresh}>
              Refresh dashboard
            </Button>
          </div>
          {gatewayError ? (
            <Alert variant="destructive">
              <AlertDescription>{gatewayError}</AlertDescription>
            </Alert>
          ) : null}
          {gatewayStatus ? (
            <GatewayDetails status={gatewayStatus} />
          ) : (
            <EmptyState message="Loading gateway status..." />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
```

```tsx
// src/admin/App.tsx
return (
  <AdminShell currentPath={currentPath}>
    {currentPath === "/admin" ? (
      <AdminOverviewPage
        gatewayStatus={gatewayStatus}
        overview={overview}
        overviewError={overviewError}
        guildNamesById={guildNamesById}
        onStartGateway={handleGatewayStart}
        onRefresh={loadOverview}
      />
    ) : null}
    {currentPath === "/admin/gateway" ? (
      <AdminGatewayPage
        gatewayStatus={gatewayStatus}
        gatewayError={gatewayError}
        onStartGateway={handleGatewayStart}
        onRefresh={loadOverview}
      />
    ) : null}
  </AdminShell>
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "gateway workspace"`
Expected: PASS for the gateway-page route test.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/admin-gateway-page.tsx src/admin/App.tsx test/admin-app.test.tsx
git commit -m "feat: split gateway into its own dashboard page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Extract the blocklist workflow into its own page

**Files:**

- Create: `src/admin/components/admin-form-layout.tsx`
- Create: `src/admin/components/admin-blocklist-page.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("authenticated admin dashboard renders the blocklist workspace on /admin/blocklist", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin/blocklist" />);

  assert.match(html, /aria-current="page"[^>]*>Blocklist</);
  assert.match(html, /Load blocklist/i);
  assert.match(html, /Apply/i);
  assert.match(html, /Filter servers/i);
  assert.doesNotMatch(html, /Add timed role/i);
  assert.doesNotMatch(html, /Load ticket panel/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "blocklist workspace"`
Expected: FAIL because `/admin/blocklist` does not have a dedicated page yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/admin-form-layout.tsx
export function EditorPanel({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-lg border bg-muted/30 p-4 md:p-6">{children}</div>;
}

export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function EditorActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:justify-end">{children}</div>
  );
}
```

```tsx
// src/admin/components/admin-blocklist-page.tsx
export function AdminBlocklistPage({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  const [guildId, setGuildId] = useState("");
  const [emoji, setEmoji] = useState("");
  const [action, setAction] = useState<"add" | "remove">("add");
  const [currentEmojis, setCurrentEmojis] = useState<string[] | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function loadBlocklist(id: string) {
    const normalizedGuildId = id.trim();
    if (!normalizedGuildId) {
      setCurrentEmojis(null);
      return;
    }

    const response = await fetch(
      `/admin/api/blocklist?guildId=${encodeURIComponent(normalizedGuildId)}`,
    );
    if (response.ok) {
      const data = (await response.json()) as { emojis: string[] };
      setCurrentEmojis(data.emojis);
    }
  }

  async function handleSubmit() {
    const response = await fetch("/admin/api/blocklist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId, emoji, action }),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        guilds: Record<string, { emojis: string[] }>;
      };
      setCurrentEmojis(data.guilds?.[guildId]?.emojis ?? null);
      setResult(`${action === "add" ? "Blocked" : "Unblocked"} ${emoji} in ${guildId}`);
    }
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Blocklist"
        description="Load the server blocklist, then add or remove blocked reaction emoji."
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <EditorPanel>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1.05fr)_minmax(14rem,0.95fr)]">
              <GuildPicker
                id="bl-guild"
                value={guildId}
                guildDirectory={guildDirectory}
                loadError={guildLookupError}
                onChange={setGuildId}
              />
              <FormField label="Emoji" htmlFor="bl-emoji">
                <Input
                  id="bl-emoji"
                  value={emoji}
                  onChange={(event) => setEmoji(event.target.value)}
                />
              </FormField>
            </div>
            <EditorActions>
              <Button variant="outline" onClick={() => void loadBlocklist(guildId)}>
                Load blocklist
              </Button>
              <Button onClick={() => void handleSubmit()}>Apply</Button>
            </EditorActions>
          </EditorPanel>
          {currentEmojis !== null ? (
            <p className="text-sm text-muted-foreground">
              {currentEmojis.join(" ") || "No emojis currently blocked in this guild."}
            </p>
          ) : null}
          {result ? (
            <Alert>
              <AlertDescription>{result}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
```

```tsx
// src/admin/App.tsx
{
  currentPath === "/admin/blocklist" ? (
    <AdminBlocklistPage guildDirectory={guildDirectory} guildLookupError={guildLookupError} />
  ) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "blocklist workspace"`
Expected: PASS for the blocklist-page route test.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/admin-form-layout.tsx src/admin/components/admin-blocklist-page.tsx src/admin/App.tsx test/admin-app.test.tsx
git commit -m "feat: split blocklist into its own dashboard page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Extract the timed-role workflow into its own page

**Files:**

- Create: `src/admin/components/admin-timed-roles-page.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
test("authenticated admin dashboard renders the timed roles workspace on /admin/timed-roles", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin/timed-roles" />);

  assert.match(html, /aria-current="page"[^>]*>Timed Roles</);
  assert.match(html, /Load timed roles/i);
  assert.match(html, /Add timed role/i);
  assert.match(html, /Duration/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Load ticket panel/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "timed roles workspace"`
Expected: FAIL because `/admin/timed-roles` does not have a dedicated page yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/admin-timed-roles-page.tsx
export function AdminTimedRolesPage({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  const [guildId, setGuildId] = useState("");
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [duration, setDuration] = useState("1h");
  const [assignments, setAssignments] = useState<TimedRoleAssignment[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAssignments(nextGuildId: string) {
    const normalizedGuildId = nextGuildId.trim();
    if (!normalizedGuildId) {
      setAssignments(null);
      return;
    }

    const response = await fetch(
      `/admin/api/timed-roles?guildId=${encodeURIComponent(normalizedGuildId)}`,
    );
    if (!response.ok) {
      setError("Failed to load timed roles.");
      return;
    }

    const data = (await response.json()) as { assignments: TimedRoleAssignment[] };
    setAssignments(data.assignments);
  }

  async function handleAdd() {
    const response = await fetch("/admin/api/timed-roles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add", guildId, userId, roleId, duration }),
    });

    const data = (await response.json()) as {
      assignments?: TimedRoleAssignment[];
      error?: string;
    };

    if (!response.ok) {
      setError(data.error ?? "Failed to add the timed role.");
      return;
    }

    setAssignments(data.assignments ?? []);
    setMessage(`Assigned ${roleId} to ${userId} for ${duration}.`);
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Timed Roles"
        description="Inspect scheduled role assignments and issue new ones without leaving the dashboard."
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <EditorPanel>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(8rem,0.8fr)]">
              <GuildPicker
                id="tr-guild"
                value={guildId}
                guildDirectory={guildDirectory}
                loadError={guildLookupError}
                onChange={setGuildId}
              />
              <FormField label="User ID" htmlFor="tr-user">
                <Input
                  id="tr-user"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                />
              </FormField>
              <FormField label="Role ID" htmlFor="tr-role">
                <Input
                  id="tr-role"
                  value={roleId}
                  onChange={(event) => setRoleId(event.target.value)}
                />
              </FormField>
              <FormField label="Duration" htmlFor="tr-duration">
                <Input
                  id="tr-duration"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                />
              </FormField>
            </div>
            <EditorActions>
              <Button variant="outline" onClick={() => void loadAssignments(guildId)}>
                Load timed roles
              </Button>
              <Button onClick={() => void handleAdd()}>Add timed role</Button>
            </EditorActions>
          </EditorPanel>
          {assignments?.length === 0 ? (
            <EmptyState message="No timed roles are active in this guild." />
          ) : null}
          {message ? (
            <Alert>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
```

```tsx
// src/admin/App.tsx
{
  currentPath === "/admin/timed-roles" ? (
    <AdminTimedRolesPage guildDirectory={guildDirectory} guildLookupError={guildLookupError} />
  ) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "timed roles workspace"`
Expected: PASS for the timed-roles page test.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/admin-timed-roles-page.tsx src/admin/App.tsx test/admin-app.test.tsx
git commit -m "feat: split timed roles into its own dashboard page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Extract the tickets workflow into its own page

**Files:**

- Create: `src/admin/components/admin-tickets-page.tsx`
- Modify: `src/admin/App.tsx`
- Test: `test/admin-app.test.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
test("authenticated admin dashboard renders the tickets workspace on /admin/tickets", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin/tickets" />);

  assert.match(html, /aria-current="page"[^>]*>Tickets</);
  assert.match(html, /Load ticket panel/i);
  assert.match(html, /Ticket Panels|Tickets/i);
  assert.doesNotMatch(html, /Load blocklist/i);
  assert.doesNotMatch(html, /Add timed role/i);
});

test("authenticated admin dashboard keeps the overview page free of editor controls", () => {
  const html = renderToString(<App initialAuthenticated initialPath="/admin" />);

  assert.doesNotMatch(html, /Load ticket panel/i);
  assert.doesNotMatch(html, /Load timed roles/i);
  assert.doesNotMatch(html, /Load blocklist/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "tickets workspace|overview page free"`
Expected: FAIL because tickets are still embedded in the all-in-one editor flow.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/admin/components/admin-tickets-page.tsx
export function AdminTicketsPage({
  guildDirectory,
  guildLookupError,
}: {
  guildDirectory: AdminGuildDirectoryEntry[] | null;
  guildLookupError: string | null;
}) {
  const [guildId, setGuildId] = useState("");
  const [guildResources, setGuildResources] = useState<GuildResources | null>(null);
  const [panelConfig, setPanelConfig] = useState<TicketPanelConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadResources(id: string) {
    const normalizedGuildId = id.trim();
    if (!normalizedGuildId) {
      setGuildResources(null);
      setPanelConfig(null);
      return;
    }

    setLoading(true);
    try {
      const [resourcesResponse, panelResponse] = await Promise.all([
        fetch(`/admin/api/tickets/resources?guildId=${encodeURIComponent(normalizedGuildId)}`),
        fetch(`/admin/api/tickets/panel?guildId=${encodeURIComponent(normalizedGuildId)}`),
      ]);

      if (!resourcesResponse.ok) {
        throw new Error(`Failed to load guild resources (${resourcesResponse.status})`);
      }

      const resources = (await resourcesResponse.json()) as GuildResources;
      setGuildResources(resources);

      const panelData = (await panelResponse.json()) as { panel: TicketPanelConfig | null };
      setPanelConfig(
        panelData.panel ?? {
          guildId: normalizedGuildId,
          panelChannelId: "",
          categoryChannelId: "",
          transcriptChannelId: "",
          panelTitle: null,
          panelDescription: null,
          panelFooter: null,
          panelMessageId: null,
          ticketTypes: [],
        },
      );
      setLoadError(null);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load guild data.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!panelConfig) return;
    const response = await fetch("/admin/api/tickets/panel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(panelConfig),
    });
    if (!response.ok) {
      throw new Error(`Save failed (${response.status})`);
    }
  }

  async function handlePublish() {
    if (!panelConfig) return;
    const response = await fetch("/admin/api/tickets/panel/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: panelConfig.guildId }),
    });
    if (!response.ok) {
      throw new Error(`Publish failed (${response.status})`);
    }
  }

  return (
    <section className="space-y-6">
      <AdminPageHeader
        title="Tickets"
        description="Configure ticket buttons, questions, and transcript routing."
      />
      <Card>
        <CardContent className="space-y-4 pt-6">
          <EditorPanel>
            <GuildPicker
              id="tp-guild"
              value={guildId}
              guildDirectory={guildDirectory}
              loadError={guildLookupError}
              onChange={setGuildId}
            />
            <EditorActions>
              <Button
                variant="outline"
                disabled={!guildId.trim() || loading}
                onClick={() => void loadResources(guildId)}
              >
                {loading ? "Loading…" : "Load ticket panel"}
              </Button>
            </EditorActions>
          </EditorPanel>
          {loadError ? (
            <Alert variant="destructive">
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          ) : null}
          {guildResources && panelConfig ? (
            <TicketPanelEditor
              guildResources={guildResources}
              value={panelConfig}
              onChange={setPanelConfig}
              onSave={handleSave}
              onPublish={handlePublish}
            />
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
```

```tsx
// src/admin/App.tsx
{
  currentPath === "/admin/tickets" ? (
    <AdminTicketsPage guildDirectory={guildDirectory} guildLookupError={guildLookupError} />
  ) : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/admin-app.test.js --test-name-pattern "tickets workspace|overview page free"`
Expected: PASS for both tickets-page tests.

- [ ] **Step 5: Commit**

```bash
git add src/admin/components/admin-tickets-page.tsx src/admin/App.tsx test/admin-app.test.tsx
git commit -m "feat: split tickets into their own dashboard page" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Refresh the generated admin bundle and run full verification

**Files:**

- Generated: `src/runtime/admin-bundle.ts`
- Verify: `test/admin-app.test.tsx`
- Verify: `test/runtime-app.test.ts`

- [ ] **Step 1: Rebuild and run the full repository test suite**

```bash
pnpm test
```

Expected: PASS, including the rebuilt admin bundle and the Node test suite.

- [ ] **Step 2: Run type checking**

```bash
pnpm run typecheck
```

Expected: PASS, including `build:admin`, worker TypeScript checks, and node-runtime TypeScript checks.

- [ ] **Step 3: Stage the generated bundle if it changed**

```bash
git add src/runtime/admin-bundle.ts
```

- [ ] **Step 4: Commit the generated bundle refresh**

```bash
git commit -m "build: refresh admin bundle for dashboard shell" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
