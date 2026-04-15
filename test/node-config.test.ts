/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { loadNodeRuntimeConfig } from "../src/runtime/node-config";

test("loadNodeRuntimeConfig returns the validated portable runtime config", () => {
  const config = loadNodeRuntimeConfig({
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: "a".repeat(64),
    DISCORD_APPLICATION_ID: "application-id",
    ADMIN_AUTH_SECRET: "admin-secret",
    PORT: "8787",
    SQLITE_PATH: "./data/runtime.sqlite",
  });

  assert.deepEqual(config, {
    discordBotToken: "bot-token",
    botUserId: "bot-user-id",
    discordPublicKey: "a".repeat(64),
    discordApplicationId: "application-id",
    adminAuthSecret: "admin-secret",
    port: 8787,
    sqlitePath: "./data/runtime.sqlite",
  });
});

test("loadNodeRuntimeConfig rejects missing required values", () => {
  assert.throws(
    () => loadNodeRuntimeConfig({ PORT: "8787", SQLITE_PATH: "./data/runtime.sqlite" }),
    /DISCORD_BOT_TOKEN/
  );
});
