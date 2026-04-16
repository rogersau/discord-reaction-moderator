/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { spawnSync } from "node:child_process";

test("worker tsconfig does not include admin Vite tooling files", () => {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsc", "--noEmit", "--explainFiles"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    }
  );
  const explainFiles = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, explainFiles);
  assert.doesNotMatch(explainFiles, /vite\.admin\.config\.ts/);
});
