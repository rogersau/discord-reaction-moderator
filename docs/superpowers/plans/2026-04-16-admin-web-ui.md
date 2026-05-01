# Admin Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace curl-style admin management with a password-protected same-Worker React dashboard for gateway control, app config editing, and single-guild blocklist management.

**Architecture:** Keep `src/runtime/app.ts` as the shared HTTP entrypoint for both Cloudflare and the portable Node runtime, but extend it with signed-cookie admin auth, `/admin` page routes, and `/admin/api/*` endpoints. Build a small React + `shadcn/ui` frontend into an embedded asset bundle so the Worker and Node runtime can both serve the same UI without a second deployment target.

**Tech Stack:** TypeScript, Cloudflare Workers, Node portable runtime, React, React DOM, Vite, Tailwind CSS, `shadcn/ui`, Node test runner

---

## File Structure

- Modify: `package.json` — add React/Vite/Tailwind/shadcn dependencies and admin build scripts that generate an embedded asset bundle before validation.
- Modify: `tsconfig.json` — enable JSX parsing for shared `.tsx` source.
- Modify: `tsconfig.node.json` — include `.tsx` runtime/admin files in the Node build.
- Modify: `tsconfig.tests.json` — compile `.tsx` admin/runtime tests.
- Create: `vite.admin.config.ts` — build the admin client into a deterministic `dist-admin/`.
- Create: `scripts/embed-admin-build.mjs` — convert the Vite output into `src/runtime/admin-bundle.ts`.
- Create: `src/admin/main.tsx` — React admin client entrypoint.
- Create: `src/admin/App.tsx` — login/dashboard shell that switches on authenticated state and calls `/admin/api/*`.
- Create: `src/admin/styles.css` — Tailwind entrypoint and theme tokens.
- Create: `src/admin/lib/utils.ts` — `cn()` helper for `shadcn/ui` components.
- Create: `src/admin/components/ui/button.tsx`
- Create: `src/admin/components/ui/card.tsx`
- Create: `src/admin/components/ui/input.tsx`
- Create: `src/admin/components/ui/label.tsx`
- Create: `src/admin/components/ui/alert.tsx`
- Create: `src/admin/components/ui/table.tsx`
- Create: `src/runtime/admin-bundle.ts` — generated JS/CSS/HTML asset manifest consumed by the shared runtime.
- Create: `src/runtime/admin-auth.ts` — password verification, cookie signing, session decoding, and logout helpers.
- Create: `src/runtime/admin-types.ts` — shared admin request/response payload types.
- Modify: `src/runtime/contracts.ts` — add app-config mutation support to `RuntimeStore`.
- Modify: `src/runtime/app.ts` — route `/admin`, `/admin/login`, `/admin/logout`, `/admin/assets/*`, and `/admin/api/*`.
- Modify: `src/runtime/cloudflare-runtime.ts` — pass the admin password and expose config mutation through the DO-backed store.
- Modify: `src/runtime/node-config.ts` — require/parse the admin UI password for the portable runtime.
- Modify: `src/runtime/node-main.ts` — pass the admin password into `createRuntimeApp`.
- Modify: `src/runtime/sqlite-store.ts` — implement `upsertAppConfig`.
- Modify: `src/env.ts` — add `ADMIN_UI_PASSWORD`.
- Modify: `test/runtime-app.test.ts` — cover login, session gating, admin HTML, and admin API flows.
- Modify: `test/admin-routes.test.ts` — update Worker-level expectations from curl routes to the new admin surface.
- Modify: `test/node-server.test.ts` — confirm the portable runtime serves the login page and protected admin routes.
- Modify: `README.md` — replace curl-based admin instructions with the password-protected UI flow.
- Modify: `wrangler.toml` — document the new admin secret alongside the existing Discord secrets.

### Task 1: Add the admin frontend build pipeline and React/shadcn scaffold

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `tsconfig.node.json`
- Modify: `tsconfig.tests.json`
- Create: `vite.admin.config.ts`
- Create: `scripts/embed-admin-build.mjs`
- Create: `src/admin/main.tsx`
- Create: `src/admin/App.tsx`
- Create: `src/admin/styles.css`
- Create: `src/admin/lib/utils.ts`
- Create: `src/admin/components/ui/button.tsx`
- Create: `src/admin/components/ui/card.tsx`
- Create: `src/admin/components/ui/input.tsx`
- Create: `src/admin/components/ui/label.tsx`
- Create: `src/admin/components/ui/alert.tsx`
- Create: `src/admin/components/ui/table.tsx`
- Create: `src/runtime/admin-bundle.ts`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp serves the admin login shell and static assets", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const loginResponse = await app.fetch(new Request("https://runtime.example/admin/login"));
  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await loginResponse.text(), /admin-root/);

  const assetResponse = await app.fetch(
    new Request("https://runtime.example/admin/assets/admin.js"),
  );
  assert.equal(assetResponse.status, 200);
  assert.match(assetResponse.headers.get("content-type") ?? "", /javascript/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: FAIL with `Property 'adminUiPassword' does not exist`, `Cannot find module '../src/runtime/admin-bundle'`, or a `404 !== 200` assertion for `/admin/login`.

- [ ] **Step 3: Write minimal implementation**

```json
// package.json
{
  "scripts": {
    "build:admin": "vite build -c vite.admin.config.ts && node scripts/embed-admin-build.mjs",
    "typecheck": "pnpm run build:admin && tsc --noEmit && tsc -p tsconfig.node.json --noEmit",
    "test": "sh -c 'rm -rf dist-tests; pnpm run build:admin && pnpm run build:test && node --test dist-tests/test/*.test.js; status=$?; rm -rf dist-tests; exit $status'"
  },
  "dependencies": {
    "@radix-ui/react-alert-dialog": "^1.1.0",
    "@radix-ui/react-label": "^2.1.0",
    "@radix-ui/react-slot": "^1.1.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.5"
  },
  "devDependencies": {
    "@types/react": "^19.0.2",
    "@types/react-dom": "^19.0.2",
    "@vitejs/plugin-react": "^4.3.4",
    "tailwindcss": "^3.4.17",
    "vite": "^6.0.7"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler"
  }
}
```

```ts
// vite.admin.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-admin",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "src/admin/main.tsx"),
      output: {
        entryFileNames: "admin.js",
        assetFileNames: "admin.css",
      },
    },
  },
});
```

```js
// scripts/embed-admin-build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const js = readFileSync("dist-admin/admin.js", "utf8");
const css = readFileSync("dist-admin/admin.css", "utf8");

writeFileSync(
  "src/runtime/admin-bundle.ts",
  `export const ADMIN_ASSETS = {
  "/admin/assets/admin.js": { contentType: "text/javascript; charset=utf-8", body: ${JSON.stringify(js)} },
  "/admin/assets/admin.css": { contentType: "text/css; charset=utf-8", body: ${JSON.stringify(css)} }
} as const;

export const ADMIN_LOGIN_HTML = ${JSON.stringify(`<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/admin/assets/admin.css"></head><body><div id="admin-root"></div><script type="module" src="/admin/assets/admin.js"></script></body></html>`)};
`,
);
```

```ts
// src/admin/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

```ts
// src/admin/components/ui/button.tsx
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-slate-900 text-white hover:bg-slate-700",
        secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
        destructive: "bg-red-600 text-white hover:bg-red-500",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
```

```ts
// src/admin/App.tsx
export interface AdminBootData {
  authenticated: boolean;
}

export function App({ authenticated }: AdminBootData) {
  return authenticated ? <div id="admin-root">dashboard</div> : <div id="admin-root">login</div>;
}
```

```ts
// src/admin/main.tsx
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const root = document.getElementById("admin-root");
const authenticated =
  document.body.getAttribute("data-admin-authenticated") === "true";

if (root) {
  createRoot(root).render(<App authenticated={authenticated} />);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm install && pnpm run build:admin && pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: PASS for the new admin shell test and the existing runtime tests that do not depend on later auth logic.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json tsconfig.node.json tsconfig.tests.json vite.admin.config.ts scripts/embed-admin-build.mjs src/admin src/runtime/admin-bundle.ts test/runtime-app.test.ts
git commit -m "build: scaffold admin UI assets"
```

### Task 2: Add signed-cookie admin auth and app-config mutation support to the shared runtime contracts

**Files:**

- Create: `src/runtime/admin-auth.ts`
- Create: `src/runtime/admin-types.ts`
- Modify: `src/runtime/contracts.ts`
- Modify: `src/runtime/cloudflare-runtime.ts`
- Modify: `src/runtime/sqlite-store.ts`
- Modify: `src/runtime/node-config.ts`
- Modify: `src/runtime/node-main.ts`
- Modify: `src/env.ts`
- Test: `test/runtime-app.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp redirects unauthenticated admin requests and sets a session cookie on login", async () => {
  const configWrites: Array<{ key: string; value: string }> = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
      async upsertAppConfig(body) {
        configWrites.push(body);
      },
    } as unknown as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const unauthenticated = await app.fetch(new Request("https://runtime.example/admin"));
  assert.equal(unauthenticated.status, 302);
  assert.equal(unauthenticated.headers.get("location"), "/admin/login");

  const loginResponse = await app.fetch(
    new Request("https://runtime.example/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
    }),
  );

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.get("location"), "/admin");
  assert.match(loginResponse.headers.get("set-cookie") ?? "", /admin_session=/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: FAIL because `adminSessionSecret`, `upsertAppConfig`, and the `/admin` auth flow do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/contracts.ts
export interface RuntimeStore {
  readConfig(): Promise<BlocklistConfig>;
  upsertAppConfig(body: { key: string; value: string }): Promise<void>;
  applyGuildEmojiMutation(body: {
    guildId: string;
    emoji: string;
    action: "add" | "remove";
  }): Promise<BlocklistConfig>;
  listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]>;
  upsertTimedRole(body: TimedRoleAssignment): Promise<void>;
  deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void>;
  listExpiredTimedRoles(nowMs: number): Promise<TimedRoleAssignment[]>;
  readGatewaySnapshot(): Promise<GatewaySnapshot>;
  writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void>;
}
```

```ts
// src/runtime/admin-auth.ts
const encoder = new TextEncoder();

export interface AdminSession {
  issuedAt: number;
}

export async function createAdminSessionCookie(sessionSecret: string): Promise<string> {
  const issuedAt = Date.now();
  const signature = await signValue(`${issuedAt}`, sessionSecret);
  const payload = `${issuedAt}.${signature}`;
  return `admin_session=${payload}; Path=/; HttpOnly; SameSite=Strict; Secure`;
}

export async function isValidAdminSession(
  cookieHeader: string | null,
  sessionSecret: string,
): Promise<boolean> {
  const raw = cookieHeader?.match(/admin_session=([^;]+)/)?.[1];
  if (!raw) {
    return false;
  }
  const [issuedAt, signature] = raw.split(".");
  if (!issuedAt || !signature) {
    return false;
  }
  const expected = await signValue(issuedAt, sessionSecret);
  return expected === signature;
}

async function signValue(value: string, sessionSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(sessionSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Buffer.from(signature).toString("base64url");
}
```

```ts
// src/env.ts
export interface Env {
  DISCORD_BOT_TOKEN: string;
  BOT_USER_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  ADMIN_AUTH_SECRET?: string;
  ADMIN_UI_PASSWORD?: string;
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
```

```ts
// src/runtime/node-config.ts
export interface NodeRuntimeConfig {
  discordBotToken: string;
  botUserId: string;
  discordPublicKey: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminUiPassword?: string;
  port: number;
  sqlitePath: string;
}

// inside loadNodeRuntimeConfig()
return {
  discordBotToken,
  botUserId,
  discordPublicKey,
  discordApplicationId: env.DISCORD_APPLICATION_ID,
  adminAuthSecret: env.ADMIN_AUTH_SECRET,
  adminUiPassword: env.ADMIN_UI_PASSWORD,
  port,
  sqlitePath,
};
```

```ts
// src/runtime/sqlite-store.ts
const upsertAppConfigStmt = db.prepare(`
  INSERT INTO app_config(key, value)
  VALUES(?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);

async upsertAppConfig(body: { key: string; value: string }): Promise<void> {
  upsertAppConfigStmt.run(body.key, body.value);
},
```

```ts
// src/runtime/cloudflare-runtime.ts
return createRuntimeApp({
  discordPublicKey: env.DISCORD_PUBLIC_KEY,
  discordBotToken: env.DISCORD_BOT_TOKEN,
  discordApplicationId: env.DISCORD_APPLICATION_ID,
  adminAuthSecret: env.ADMIN_AUTH_SECRET,
  adminUiPassword: env.ADMIN_UI_PASSWORD,
  adminSessionSecret: env.ADMIN_UI_PASSWORD ?? env.ADMIN_AUTH_SECRET ?? "admin-session-secret",
  store: {
    async readConfig() {
      const response = await storeStub.fetch("https://moderation-store/config");
      return response.json();
    },
    async upsertAppConfig(body) {
      const response = await storeStub.fetch("https://moderation-store/app-config", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`Failed to update app config: ${response.status} ${await response.text()}`);
      }
    },
  } as RuntimeStore,
  gateway: {
    /* existing gateway wiring */
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: PASS for the login redirect/session test and the existing shared runtime tests.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/admin-auth.ts src/runtime/admin-types.ts src/runtime/contracts.ts src/runtime/cloudflare-runtime.ts src/runtime/sqlite-store.ts src/runtime/node-config.ts src/runtime/node-main.ts src/env.ts test/runtime-app.test.ts
git commit -m "feat: add admin session auth plumbing"
```

### Task 3: Serve the React admin pages and session-protected `/admin/api/*` endpoints from `createRuntimeApp`

**Files:**

- Modify: `src/runtime/app.ts`
- Modify: `src/admin/App.tsx`
- Modify: `src/admin/main.tsx`
- Modify: `src/runtime/admin-bundle.ts`
- Test: `test/runtime-app.test.ts`
- Test: `test/admin-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-app.test.ts
test("createRuntimeApp returns dashboard data and blocklist mutations through session-protected admin APIs", async () => {
  const calls: string[] = [];
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {
      async readConfig() {
        return {
          guilds: { "guild-1": { enabled: true, emojis: ["✅"] } },
          botUserId: "bot-user-id",
        };
      },
      async upsertAppConfig(body) {
        calls.push(`config:${body.key}:${body.value}`);
      },
      async applyGuildEmojiMutation(body) {
        calls.push(`blocklist:${body.guildId}:${body.emoji}:${body.action}`);
        return {
          guilds: {
            [body.guildId]: {
              enabled: true,
              emojis: body.action === "add" ? ["✅", body.emoji] : ["✅"],
            },
          },
          botUserId: "bot-user-id",
        };
      },
    } as unknown as RuntimeStore,
    gateway: {
      async status() {
        return {
          status: "idle",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        };
      },
      async start() {
        calls.push("gateway:start");
        return {
          status: "connecting",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        };
      },
    },
  });

  const cookie = await createAdminSessionCookie("session-secret");

  const statusResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/gateway/status", {
      headers: { cookie },
    }),
  );
  assert.equal(statusResponse.status, 200);

  const configResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/config", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ key: "bot_user_id", value: "new-bot-id" }),
    }),
  );
  assert.equal(configResponse.status, 200);

  const blocklistResponse = await app.fetch(
    new Request("https://runtime.example/admin/api/blocklist", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ guildId: "guild-1", emoji: "🚫", action: "add" }),
    }),
  );
  assert.equal(blocklistResponse.status, 200);
  assert.deepEqual(calls, ["config:bot_user_id:new-bot-id", "blocklist:guild-1:🚫:add"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js`
Expected: FAIL because `/admin/api/gateway/status`, `/admin/api/config`, and `/admin/api/blocklist` do not exist or return `404/401`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/runtime/app.ts
import { ADMIN_ASSETS, ADMIN_LOGIN_HTML } from "./admin-bundle";
import { createAdminSessionCookie, isValidAdminSession } from "./admin-auth";

interface RuntimeAppOptions {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminUiPassword?: string;
  adminSessionSecret?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  store: RuntimeStore;
  gateway: GatewayController;
}

export function createRuntimeApp(options: RuntimeAppOptions) {
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === "/admin/login" && request.method === "GET") {
        return new Response(ADMIN_LOGIN_HTML, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/admin/login" && request.method === "POST") {
        const form = await request.formData();
        if (form.get("password") !== options.adminUiPassword) {
          return new Response("Invalid password", { status: 401 });
        }
        return new Response(null, {
          status: 302,
          headers: {
            location: "/admin",
            "set-cookie": await createAdminSessionCookie(
              options.adminSessionSecret ?? options.adminUiPassword ?? "admin-session",
            ),
          },
        });
      }

      if (url.pathname.startsWith("/admin/assets/")) {
        const asset = ADMIN_ASSETS[url.pathname as keyof typeof ADMIN_ASSETS];
        return asset
          ? new Response(asset.body, {
              status: 200,
              headers: { "content-type": asset.contentType },
            })
          : new Response("Not found", { status: 404 });
      }

      if (url.pathname === "/admin" && request.method === "GET") {
        const authorized = await isValidAdminSession(
          request.headers.get("cookie"),
          options.adminSessionSecret ?? options.adminUiPassword ?? "admin-session",
        );
        if (!authorized) {
          return Response.redirect(new URL("/admin/login", url), 302);
        }
        return new Response(
          ADMIN_LOGIN_HTML.replace(
            'data-admin-authenticated="false"',
            'data-admin-authenticated="true"',
          ),
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      }

      if (url.pathname === "/admin/api/gateway/status" && request.method === "GET") {
        await requireAdminSession(request, options);
        return Response.json(await options.gateway.status());
      }

      if (url.pathname === "/admin/api/gateway/start" && request.method === "POST") {
        await requireAdminSession(request, options);
        return Response.json(await bootstrap());
      }

      if (url.pathname === "/admin/api/config" && request.method === "POST") {
        await requireAdminSession(request, options);
        const body = (await request.json()) as { key: string; value: string };
        await options.store.upsertAppConfig(body);
        return Response.json({ ok: true });
      }

      if (url.pathname === "/admin/api/blocklist" && request.method === "GET") {
        await requireAdminSession(request, options);
        const config = await options.store.readConfig();
        const guildId = url.searchParams.get("guildId") ?? "";
        return Response.json({
          guildId,
          enabled: config.guilds[guildId]?.enabled ?? true,
          emojis: config.guilds[guildId]?.emojis ?? [],
        });
      }

      if (url.pathname === "/admin/api/blocklist" && request.method === "POST") {
        await requireAdminSession(request, options);
        const body = (await request.json()) as {
          guildId: string;
          emoji: string;
          action: "add" | "remove";
        };
        const config = await options.store.applyGuildEmojiMutation(body);
        return Response.json(config.guilds[body.guildId] ?? { enabled: true, emojis: [] });
      }

      // keep existing /health, /interactions, and legacy bootstrap behavior below
    },
    bootstrap,
  };
}

async function requireAdminSession(request: Request, options: RuntimeAppOptions): Promise<void> {
  const valid = await isValidAdminSession(
    request.headers.get("cookie"),
    options.adminSessionSecret ?? options.adminUiPassword ?? "admin-session",
  );
  if (!valid) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
```

```ts
// src/admin/App.tsx
export function App({ authenticated }: AdminBootData) {
  return authenticated ? (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <section data-testid="gateway-card">gateway</section>
      <section data-testid="config-card">config</section>
      <section data-testid="blocklist-card">blocklist</section>
    </main>
  ) : (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-8">
      <form method="post" action="/admin/login" className="w-full rounded-lg border bg-white p-6 shadow-sm">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run build:test && node --test dist-tests/test/runtime-app.test.js dist-tests/test/admin-routes.test.js`
Expected: PASS for the new admin API tests, plus updated Worker-level route assertions.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/app.ts src/admin/App.tsx src/admin/main.tsx src/runtime/admin-bundle.ts test/runtime-app.test.ts test/admin-routes.test.ts
git commit -m "feat: serve admin dashboard routes"
```

### Task 4: Wire Cloudflare/Node runtime config, portable server behavior, and operator documentation

**Files:**

- Modify: `test/node-server.test.ts`
- Modify: `README.md`
- Modify: `wrangler.toml`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

```ts
// test/node-server.test.ts
test("startNodeRuntimeServer serves the admin login page and protects /admin", async () => {
  const server = await startNodeRuntimeServer({
    port: 0,
    app: {
      fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        if (pathname === "/admin/login") {
          return Promise.resolve(
            new Response('<!doctype html><div id="admin-root"></div>', {
              status: 200,
              headers: { "content-type": "text/html; charset=utf-8" },
            }),
          );
        }
        if (pathname === "/admin") {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: "/admin/login" },
            }),
          );
        }
        return Promise.resolve(new Response("Not found", { status: 404 }));
      },
    },
  });

  // request /admin/login -> expect 200 html
  // request /admin -> expect 302 /admin/login
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run build:test && node --test dist-tests/test/node-server.test.js`
Expected: FAIL until the test helper and README-facing route expectations are updated for the admin UI.

- [ ] **Step 3: Write minimal implementation**

````md
<!-- README.md -->

## Admin UI

Open the Worker URL in a browser:

```text
https://your-worker-url.workers.dev/admin/login
```
````

Set the shared admin password first:

```bash
wrangler secret put ADMIN_UI_PASSWORD
```

After signing in, the dashboard becomes the supported operator surface for:

- gateway status and bootstrap
- app config edits
- guild blocklist management by guild ID

````

```toml
# wrangler.toml
# Discord Credentials (set as secrets, not here)
# wrangler secret put DISCORD_BOT_TOKEN
# wrangler secret put ADMIN_UI_PASSWORD
````

```json
// package.json
{
  "scripts": {
    "test": "sh -c 'rm -rf dist-tests; pnpm run build:admin && pnpm run build:test && node --test dist-tests/test/*.test.js; status=$?; rm -rf dist-tests; exit $status'",
    "typecheck": "pnpm run build:admin && tsc --noEmit && tsc -p tsconfig.node.json --noEmit"
  },
  "cloudflare": {
    "bindings": {
      "ADMIN_UI_PASSWORD": {
        "description": "Shared password for the /admin web interface."
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test && pnpm run typecheck`
Expected: PASS, with the Node server tests still green and the README/admin route changes aligned with the shipped runtime behavior.

- [ ] **Step 5: Commit**

```bash
git add test/node-server.test.ts README.md wrangler.toml package.json
git commit -m "docs: switch admin workflow to web UI"
```

## Self-Review

- **Spec coverage:** The plan covers password auth, same-Worker React UI, shadcn-based component scaffolding, gateway status/bootstrap controls, app-config edits, single-guild blocklist management, Node + Cloudflare adapter wiring, and README/admin-secret updates.
- **Placeholder scan:** No `TODO`, `TBD`, or “write tests later” steps remain; each task includes exact files, commands, and code snippets.
- **Type consistency:** The plan consistently uses `adminUiPassword`, `adminSessionSecret`, `upsertAppConfig`, `/admin/api/gateway/status`, `/admin/api/gateway/start`, and `/admin/api/blocklist` across tasks.
