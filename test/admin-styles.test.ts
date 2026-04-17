/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

test("admin styles define a layered dark dashboard palette", () => {
  const cssPath = path.join(process.cwd(), "src/admin/styles.css");
  const css = readFileSync(cssPath, "utf8");

  assert.match(css, /color-scheme:\s*dark/);
  assert.match(css, /--background:\s*224 32% 8%/);
  assert.match(css, /--foreground:\s*210 33% 96%/);
  assert.match(css, /--card:\s*224 30% 12%/);
  assert.match(css, /--primary:\s*191 91% 64%/);
  assert.match(css, /background-image:\s*\n\s*radial-gradient/);
});
