/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";
import { renderToString } from "react-dom/server";

import App from "../src/admin/App";

test("authenticated admin dashboard renders explicit load controls for guild-scoped sections", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.match(html, /Load blocklist/i);
  assert.match(html, /Load timed roles/i);
});

test("authenticated admin dashboard avoids cramped equal-column desktop editor grids", () => {
  const html = renderToString(<App initialAuthenticated />);

  assert.doesNotMatch(html, /xl:grid-cols-5/);
  assert.doesNotMatch(html, /xl:grid-cols-6/);
  assert.doesNotMatch(html, /auto_auto/);
  assert.match(
    html,
    /rounded-\[1\.75rem\] border border-border\/70 bg-background\/30 p-5 lg:p-6/
  );
  assert.match(
    html,
    /border-t border-border\/70 pt-5 sm:flex-row sm:items-center sm:justify-end/
  );
});
