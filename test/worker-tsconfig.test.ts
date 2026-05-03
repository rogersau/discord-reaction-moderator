/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test("Cloudflare-only package scripts no longer expose portable runtime commands", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageJson.scripts["build:node"], undefined);
  assert.equal(packageJson.scripts["start:node"], undefined);
  assert.equal(packageJson.scripts["docker:build"], undefined);
});

test("worker tsconfig explainFiles no longer references removed node runtime files", () => {
  const result = runTscExplainFiles();
  const explainFiles = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, explainFiles);
  assert.doesNotMatch(explainFiles, /src\/runtime\/node-main\.ts/);
  assert.doesNotMatch(explainFiles, /src\/runtime\/node-gateway-service\.ts/);
  assert.doesNotMatch(explainFiles, /tsconfig\.node\.json/);
});

test("worker tsconfig does not include admin Vite tooling files", () => {
  const result = runTscExplainFiles();
  const explainFiles = `${result.stdout}${result.stderr}`;

  assert.equal(result.status, 0, explainFiles);
  assert.doesNotMatch(explainFiles, /vite\.admin\.config\.ts/);
});

function runTscExplainFiles() {
  return spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "--explainFiles"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );
}
