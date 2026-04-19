/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { createCloudflareContext } from "../src/runtime/cloudflare-context";
import type { Env } from "../src/env";

function createMockEnv(overrides: Partial<Env> = {}): Env {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: "9113b842d4ade29e412959490d5a7dff2e74c41b12500c73612285bf4ca0e6b5",
    DISCORD_APPLICATION_ID: "app-id",
    GATEWAY_SESSION_DO: {
      get: () => ({ fetch: () => Promise.resolve(new Response()) }) as any,
      idFromName: () => ({} as any),
    } as any,
    MODERATION_STORE_DO: {
      get: () => ({ fetch: () => Promise.resolve(new Response()) }) as any,
      idFromName: () => ({} as any),
    } as any,
    ...overrides,
  };
}

test("createCloudflareContext uses ADMIN_SESSION_SECRET when explicitly set", () => {
  const env = createMockEnv({
    ADMIN_SESSION_SECRET: "explicit-session-secret",
    ADMIN_AUTH_SECRET: "auth-secret",
    ADMIN_UI_PASSWORD: "ui-password",
  });

  const context = createCloudflareContext(env);

  assert.strictEqual(context.adminSessionSecret, "explicit-session-secret");
});

test("createCloudflareContext requires dedicated ADMIN_SESSION_SECRET (no fallback to ADMIN_AUTH_SECRET)", () => {
  const env = createMockEnv({
    ADMIN_SESSION_SECRET: undefined,
    ADMIN_AUTH_SECRET: "auth-secret",
    ADMIN_UI_PASSWORD: "ui-password",
  });

  const context = createCloudflareContext(env);

  assert.strictEqual(context.adminSessionSecret, undefined, "Should not fall back to ADMIN_AUTH_SECRET");
});

test("createCloudflareContext requires dedicated ADMIN_SESSION_SECRET (no fallback to ADMIN_UI_PASSWORD)", () => {
  const env = createMockEnv({
    ADMIN_SESSION_SECRET: undefined,
    ADMIN_AUTH_SECRET: undefined,
    ADMIN_UI_PASSWORD: "ui-password",
  });

  const context = createCloudflareContext(env);

  assert.strictEqual(context.adminSessionSecret, undefined, "Should not fall back to ADMIN_UI_PASSWORD");
});

test("createCloudflareContext adminSessionSecret is undefined when no admin secrets configured", () => {
  const env = createMockEnv({
    ADMIN_SESSION_SECRET: undefined,
    ADMIN_AUTH_SECRET: undefined,
    ADMIN_UI_PASSWORD: undefined,
  });

  const context = createCloudflareContext(env);

  assert.strictEqual(context.adminSessionSecret, undefined);
});
