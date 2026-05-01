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
      idFromName: () => ({}) as any,
    } as any,
    MODERATION_STORE_DO: {
      get: () => ({ fetch: () => Promise.resolve(new Response()) }) as any,
      idFromName: () => ({}) as any,
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

  assert.strictEqual(
    context.adminSessionSecret,
    undefined,
    "Should not fall back to ADMIN_AUTH_SECRET",
  );
});

test("createCloudflareContext requires dedicated ADMIN_SESSION_SECRET (no fallback to ADMIN_UI_PASSWORD)", () => {
  const env = createMockEnv({
    ADMIN_SESSION_SECRET: undefined,
    ADMIN_AUTH_SECRET: undefined,
    ADMIN_UI_PASSWORD: "ui-password",
  });

  const context = createCloudflareContext(env);

  assert.strictEqual(
    context.adminSessionSecret,
    undefined,
    "Should not fall back to ADMIN_UI_PASSWORD",
  );
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

test("createCloudflareContext exposes grouped stores by bounded context", () => {
  const env = createMockEnv();
  const context = createCloudflareContext(env);

  assert.ok(context.stores, "context.stores should be defined");
  assert.ok(context.stores.blocklist, "context.stores.blocklist should be defined");
  assert.ok(context.stores.appConfig, "context.stores.appConfig should be defined");
  assert.ok(context.stores.timedRoles, "context.stores.timedRoles should be defined");
  assert.ok(context.stores.tickets, "context.stores.tickets should be defined");

  assert.strictEqual(typeof context.stores.blocklist.readConfig, "function");
  assert.strictEqual(typeof context.stores.blocklist.applyGuildEmojiMutation, "function");
  assert.strictEqual(typeof context.stores.appConfig.upsertAppConfig, "function");
  assert.strictEqual(typeof context.stores.timedRoles.listTimedRoles, "function");
  assert.strictEqual(typeof context.stores.timedRoles.listTimedRolesByGuild, "function");
  assert.strictEqual(typeof context.stores.timedRoles.upsertTimedRole, "function");
  assert.strictEqual(typeof context.stores.timedRoles.deleteTimedRole, "function");
  assert.strictEqual(typeof context.stores.timedRoles.readNewMemberTimedRoleConfig, "function");
  assert.strictEqual(typeof context.stores.timedRoles.upsertNewMemberTimedRoleConfig, "function");
  assert.strictEqual(typeof context.stores.tickets.reserveNextTicketNumber, "function");
  assert.strictEqual(typeof context.stores.tickets.readTicketPanelConfig, "function");
  assert.strictEqual(typeof context.stores.tickets.upsertTicketPanelConfig, "function");
  assert.strictEqual(typeof context.stores.tickets.createTicketInstance, "function");
  assert.strictEqual(typeof context.stores.tickets.deleteTicketInstance, "function");
  assert.strictEqual(typeof context.stores.tickets.readOpenTicketByChannel, "function");
  assert.strictEqual(typeof context.stores.tickets.closeTicketInstance, "function");
});

test("createCloudflareContext wires ticket transcript R2 helpers when a bucket is configured", async () => {
  const bucketCalls: Array<{ action: string; key: string; body?: unknown; contentType?: string }> =
    [];
  const env = createMockEnv({
    TICKET_TRANSCRIPTS_BUCKET: {
      async put(
        key: string,
        value: unknown,
        options?: { httpMetadata?: { contentType?: string } },
      ) {
        bucketCalls.push({
          action: "put",
          key,
          body: value,
          contentType: options?.httpMetadata?.contentType,
        });
      },
      async get(key: string) {
        bucketCalls.push({ action: "get", key });
        if (key.endsWith("/proof.png")) {
          return {
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("image-bytes"));
                controller.close();
              },
            }),
            httpMetadata: { contentType: "image/png" },
          } as unknown as R2ObjectBody;
        }

        return {
          text: async () => "<html>stored transcript</html>",
        } as unknown as R2ObjectBody;
      },
    } as unknown as R2Bucket,
  });

  const context = createCloudflareContext(env);

  await context.ticketTranscriptBlobs?.putHtml(
    "guild-1/channel-1.html",
    "<html>stored transcript</html>",
  );
  const html = await context.ticketTranscriptBlobs?.getHtml("guild-1/channel-1.html");
  await context.ticketTranscriptBlobs?.putAttachment(
    "guild-1/channel-1/attachments/attachment-1/proof.png",
    "image-bytes",
    {
      contentType: "image/png",
    },
  );
  const attachment = await context.ticketTranscriptBlobs?.getAttachment(
    "guild-1/channel-1/attachments/attachment-1/proof.png",
  );

  assert.equal(html, "<html>stored transcript</html>");
  assert.equal(attachment?.contentType, "image/png");
  assert.equal(await new Response(attachment?.body).text(), "image-bytes");
  assert.deepEqual(bucketCalls, [
    {
      action: "put",
      key: "guild-1/channel-1.html",
      body: "<html>stored transcript</html>",
      contentType: "text/html; charset=utf-8",
    },
    {
      action: "get",
      key: "guild-1/channel-1.html",
    },
    {
      action: "put",
      key: "guild-1/channel-1/attachments/attachment-1/proof.png",
      body: "image-bytes",
      contentType: "image/png",
    },
    {
      action: "get",
      key: "guild-1/channel-1/attachments/attachment-1/proof.png",
    },
  ]);
});
