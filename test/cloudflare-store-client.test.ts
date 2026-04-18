/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { createCloudflareStoreClient } from "../src/runtime/cloudflare-store-client";

test("createCloudflareStoreClient uses typed methods instead of exposing raw fetches", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json({ ok: true, guilds: {}, botUserId: "bot-user-id" }) as any);
    },
  });

  await storeClient.readConfig();
  await storeClient.applyGuildEmojiMutation({ guildId: "guild-1", emoji: "✅", action: "add" });

  assert.deepEqual(requests, [
    { url: "https://moderation-store/config", method: "GET", body: null },
    {
      url: "https://moderation-store/guild-emoji",
      method: "POST",
      body: JSON.stringify({ guildId: "guild-1", emoji: "✅", action: "add" }),
    },
  ]);
});

test("createCloudflareStoreClient.upsertAppConfig sends POST to /app-config", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(new Response(null, { status: 200 }) as any);
    },
  });

  await storeClient.upsertAppConfig({ key: "server_name", value: "My Server" });

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/app-config",
      method: "POST",
      body: JSON.stringify({ key: "server_name", value: "My Server" }),
    },
  ]);
});

test("createCloudflareStoreClient.listTimedRolesByGuild sends GET with guildId query param", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json([]) as any);
    },
  });

  await storeClient.listTimedRolesByGuild("guild-123");

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/timed-roles?guildId=guild-123",
      method: "GET",
      body: null,
    },
  ]);
});

test("createCloudflareStoreClient.upsertTimedRole sends POST to /timed-role", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(new Response(null, { status: 200 }) as any);
    },
  });

  await storeClient.upsertTimedRole({
    guildId: "guild-456",
    userId: "user-789",
    roleId: "role-101",
    durationInput: "1h",
    expiresAtMs: 1234567890,
  });

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/timed-role",
      method: "POST",
      body: JSON.stringify({
        guildId: "guild-456",
        userId: "user-789",
        roleId: "role-101",
        durationInput: "1h",
        expiresAtMs: 1234567890,
      }),
    },
  ]);
});

test("createCloudflareStoreClient.readTicketPanelConfig sends GET with guildId query param", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json(null) as any);
    },
  });

  await storeClient.readTicketPanelConfig("guild-999");

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/ticket-panel?guildId=guild-999",
      method: "GET",
      body: null,
    },
  ]);
});

test("createCloudflareStoreClient.listTimedRoles sends GET to /timed-roles", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json([]) as any);
    },
  });

  await storeClient.listTimedRoles();

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/timed-roles",
      method: "GET",
      body: null,
    },
  ]);
});

test("createCloudflareStoreClient.deleteTimedRole sends POST to /timed-role/remove", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(new Response(null, { status: 200 }) as any);
    },
  });

  await storeClient.deleteTimedRole({
    guildId: "guild-111",
    userId: "user-222",
    roleId: "role-333",
  });

  assert.deepEqual(requests, [
    {
      url: "https://moderation-store/timed-role/remove",
      method: "POST",
      body: JSON.stringify({
        guildId: "guild-111",
        userId: "user-222",
        roleId: "role-333",
      }),
    },
  ]);
});
