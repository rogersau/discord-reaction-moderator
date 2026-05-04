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
      return Promise.resolve(
        Response.json({ ok: true, guilds: {}, botUserId: "bot-user-id" }) as any,
      );
    },
  });

  await storeClient.readConfig();
  await storeClient.applyGuildEmojiMutation({ guildId: "guild-1", emoji: "✅", action: "add" });

  assert.deepEqual(requests, [
    { url: "https://community-store/config", method: "GET", body: null },
    {
      url: "https://community-store/guild-emoji",
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
      url: "https://community-store/app-config",
      method: "POST",
      body: JSON.stringify({ key: "server_name", value: "My Server" }),
    },
  ]);
});

test("createCloudflareStoreClient.reserveNextTicketNumber sends POST to /ticket-number/next", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(Response.json({ ticketNumber: 7 }) as any);
    },
  });

  const ticketNumber = await storeClient.reserveNextTicketNumber("guild-123");

  assert.equal(ticketNumber, 7);
  assert.deepEqual(requests, [
    {
      url: "https://community-store/ticket-number/next",
      method: "POST",
      body: JSON.stringify({ guildId: "guild-123" }),
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
      url: "https://community-store/timed-roles?guildId=guild-123",
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
      url: "https://community-store/timed-role",
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
      url: "https://community-store/ticket-panel?guildId=guild-999",
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
      url: "https://community-store/timed-roles",
      method: "GET",
      body: null,
    },
  ]);
});

test("createCloudflareStoreClient.listTimedRoles correctly reads and parses timed role data from storage", async () => {
  const mockTimedRoles = [
    {
      guildId: "guild-123",
      userId: "user-456",
      roleId: "role-789",
      durationInput: "1h",
      expiresAtMs: 1640995200000,
    },
    {
      guildId: "guild-123",
      userId: "user-999",
      roleId: "role-888",
      durationInput: "2d",
      expiresAtMs: 1641081600000,
    },
  ];

  const storeClient = createCloudflareStoreClient({
    fetch() {
      return Promise.resolve(Response.json(mockTimedRoles) as any);
    },
  });

  const result = await storeClient.listTimedRoles();

  assert.deepEqual(result, mockTimedRoles);
  assert.equal(result.length, 2);
  assert.equal(result[0].guildId, "guild-123");
  assert.equal(result[0].userId, "user-456");
  assert.equal(result[0].roleId, "role-789");
  assert.equal(result[0].durationInput, "1h");
  assert.equal(result[0].expiresAtMs, 1640995200000);
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
      url: "https://community-store/timed-role/remove",
      method: "POST",
      body: JSON.stringify({
        guildId: "guild-111",
        userId: "user-222",
        roleId: "role-333",
      }),
    },
  ]);
});

test("createCloudflareStoreClient reads and writes new member timed-role config", async () => {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  const storeClient = createCloudflareStoreClient({
    fetch(input, init) {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      return Promise.resolve(
        Response.json({
          guildId: "guild-123",
          roleId: "role-newbie",
          durationInput: "2h",
        }) as any,
      );
    },
  });

  const config = await storeClient.readNewMemberTimedRoleConfig("guild-123");
  await storeClient.upsertNewMemberTimedRoleConfig(config);

  assert.deepEqual(requests, [
    {
      url: "https://community-store/timed-role/new-member-config?guildId=guild-123",
      method: "GET",
      body: null,
    },
    {
      url: "https://community-store/timed-role/new-member-config",
      method: "POST",
      body: JSON.stringify(config),
    },
  ]);
});

test("createCloudflareStoreClient throws descriptive error on non-ok response", async () => {
  const storeClient = createCloudflareStoreClient({
    fetch() {
      return Promise.resolve(new Response("Internal Server Error", { status: 500 }) as any);
    },
  });

  await assert.rejects(
    async () => {
      await storeClient.readConfig();
    },
    {
      name: "Error",
      message: /Cloudflare store request failed: 500 Internal Server Error/,
    },
  );
});

test("createCloudflareStoreClient error handling works for void methods", async () => {
  const storeClient = createCloudflareStoreClient({
    fetch() {
      return Promise.resolve(new Response("Bad Request", { status: 400 }) as any);
    },
  });

  await assert.rejects(
    async () => {
      await storeClient.upsertAppConfig({ key: "test", value: "value" });
    },
    {
      name: "Error",
      message: /Cloudflare store request failed: 400 Bad Request/,
    },
  );
});
