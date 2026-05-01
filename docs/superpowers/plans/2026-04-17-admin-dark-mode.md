# Admin Dark Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin web interface render in a dark theme by default by replacing the shared admin color tokens with a dark palette.

**Architecture:** The admin UI already centralizes its semantic colors in `src/admin/styles.css`, and the React components consume those tokens through Tailwind utility classes. The implementation should verify the token values with a focused test, then swap the shared palette and regenerate the embedded admin bundle so runtime-served assets stay in sync.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, Node test runner, pnpm

---

### Task 1: Lock the dark palette behavior with a focused test

**Files:**

- Create: `test/admin-styles.test.ts`
- Check: `src/admin/styles.css`
- Check: `tsconfig.tests.json`

- [ ] **Step 1: Write the failing test**

```ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

test("admin styles define a dark default palette", () => {
  const cssPath = path.join(process.cwd(), "src/admin/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /--background:\s*222\.2 84% 4\.9%/);
  assert.match(css, /--foreground:\s*210 40% 98%/);
  assert.match(css, /--card:\s*222\.2 84% 4\.9%/);
  assert.match(css, /--card-foreground:\s*210 40% 98%/);
  assert.match(css, /--input:\s*217\.2 32\.6% 17\.5%/);
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run:

```bash
rm -rf dist-tests && pnpm run build:test && node --test dist-tests/test/admin-styles.test.js
```

Expected: FAIL because `src/admin/styles.css` still contains the current light palette values.

- [ ] **Step 3: Save the test file**

```ts
// test/admin-styles.test.ts
/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

test("admin styles define a dark default palette", () => {
  const cssPath = path.join(process.cwd(), "src/admin/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /--background:\s*222\.2 84% 4\.9%/);
  assert.match(css, /--foreground:\s*210 40% 98%/);
  assert.match(css, /--card:\s*222\.2 84% 4\.9%/);
  assert.match(css, /--card-foreground:\s*210 40% 98%/);
  assert.match(css, /--input:\s*217\.2 32\.6% 17\.5%/);
});
```

### Task 2: Replace the shared admin palette and regenerate the embedded bundle

**Files:**

- Modify: `src/admin/styles.css`
- Regenerate: `src/runtime/admin-bundle.ts`
- Check: `src/admin/components/ui/card.tsx`
- Check: `src/admin/components/ui/input.tsx`

- [ ] **Step 1: Replace the light token values with the dark palette**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
    --radius: 0.5rem;
  }
}
```

- [ ] **Step 2: Rebuild the admin bundle**

Run:

```bash
pnpm run build:admin
```

Expected: PASS and `src/runtime/admin-bundle.ts` updates to embed the dark-mode admin assets.

- [ ] **Step 3: Run the targeted dark-palette test**

Run:

```bash
rm -rf dist-tests && pnpm run build:test && node --test dist-tests/test/admin-styles.test.js
```

Expected: PASS with the new `admin styles define a dark default palette` test succeeding.

### Task 3: Run the existing repository verification and commit only the dark mode files

**Files:**

- Verify: `test/admin-styles.test.ts`
- Verify: `src/admin/styles.css`
- Verify: `src/runtime/admin-bundle.ts`

- [ ] **Step 1: Run typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS after rebuilding admin assets and checking TypeScript.

- [ ] **Step 2: Run the full test suite**

Run:

```bash
pnpm test
```

Expected: PASS with the existing repository tests plus the new admin styles test.

- [ ] **Step 3: Commit only the files for this change**

```bash
git add -- test/admin-styles.test.ts src/admin/styles.css src/runtime/admin-bundle.ts docs/superpowers/specs/2026-04-17-admin-dark-mode-design.md docs/superpowers/plans/2026-04-17-admin-dark-mode.md
git commit -m "style: default admin UI to dark mode"
```
