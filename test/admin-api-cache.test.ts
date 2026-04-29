/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import { buildAdminOverviewGuilds, createAdminApiHandler } from "../src/runtime/admin-api";

test("admin guild directory reuses cached Discord guilds until refresh is requested", async () => {
  const originalFetch = globalThis.fetch;
  const discordRequests: string[] = [];
  globalThis.fetch = async (input) => {
    discordRequests.push(String(input));
    return Response.json([{ id: "guild-1", name: "Guild One" }]);
  };

  try {
    const handler = createAdminApiHandler({
      stores: createStores(),
      discordBotToken: "token",
    });

    await handler(new Request("https://example.com/admin/api/guilds"), new URL("https://example.com/admin/api/guilds"));
    await handler(new Request("https://example.com/admin/api/guilds"), new URL("https://example.com/admin/api/guilds"));
    assert.deepEqual(discordRequests, ["https://discord.com/api/v10/users/@me/guilds"]);

    await handler(
      new Request("https://example.com/admin/api/guilds?refresh=1"),
      new URL("https://example.com/admin/api/guilds?refresh=1")
    );
    assert.deepEqual(discordRequests, [
      "https://discord.com/api/v10/users/@me/guilds",
      "https://discord.com/api/v10/users/@me/guilds",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin permission checks cache warning results until refresh is requested", async () => {
  const originalFetch = globalThis.fetch;
  const discordRequests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    discordRequests.push(url);
    if (url.endsWith("/channels")) {
      return Response.json([]);
    }
    if (url.endsWith("/roles")) {
      return Response.json([{ id: "guild-1", name: "@everyone", permissions: "0", position: 0 }]);
    }
    if (url.endsWith("/members/bot-1")) {
      return Response.json({ roles: [] });
    }
    throw new Error(`Unexpected Discord request ${url}`);
  };

  try {
    const handler = createAdminApiHandler({
      stores: createStores(),
      discordBotToken: "token",
    });
    const url = "https://example.com/admin/api/permissions?guildId=guild-1&feature=blocklist";

    const firstResponse = await handler(new Request(url), new URL(url));
    const secondResponse = await handler(new Request(url), new URL(url));
    assert.equal(firstResponse?.status, 200);
    assert.equal(secondResponse?.status, 200);
    assert.equal(discordRequests.length, 3);

    const refreshedUrl = `${url}&refresh=1`;
    await handler(new Request(refreshedUrl), new URL(refreshedUrl));
    assert.equal(discordRequests.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin overview permission checks reuse cache until refresh is requested", async () => {
  const originalFetch = globalThis.fetch;
  const discordRequests: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    discordRequests.push(url);
    if (url.endsWith("/channels")) {
      return Response.json([]);
    }
    if (url.endsWith("/roles")) {
      return Response.json([{ id: "guild-1", name: "@everyone", permissions: "0", position: 0 }]);
    }
    if (url.endsWith("/members/bot-overview")) {
      return Response.json({ roles: [] });
    }
    throw new Error(`Unexpected Discord request ${url}`);
  };

  try {
    const config = {
      botUserId: "bot-overview",
      guilds: { "guild-overview": { enabled: true, emojis: ["😀"] } },
    };

    await buildAdminOverviewGuilds(config, [], "token-overview", false);
    await buildAdminOverviewGuilds(config, [], "token-overview", false);
    assert.equal(discordRequests.length, 3);

    await buildAdminOverviewGuilds(config, [], "token-overview", true);
    assert.equal(discordRequests.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin permission checks cache Discord lookup failures until refresh is requested", async () => {
  const originalFetch = globalThis.fetch;
  const discordRequests: string[] = [];
  globalThis.fetch = async (input) => {
    discordRequests.push(String(input));
    return new Response("rate limited", { status: 429 });
  };

  try {
    const handler = createAdminApiHandler({
      stores: createStores(),
      discordBotToken: "token-failure",
    });
    const url = "https://example.com/admin/api/permissions?guildId=guild-1&feature=blocklist";

    const firstResponse = await handler(new Request(url), new URL(url));
    const secondResponse = await handler(new Request(url), new URL(url));
    assert.equal(firstResponse?.status, 502);
    assert.equal(secondResponse?.status, 502);
    assert.equal(discordRequests.length, 3);

    const refreshedUrl = `${url}&refresh=1`;
    await handler(new Request(refreshedUrl), new URL(refreshedUrl));
    assert.equal(discordRequests.length, 6);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function createStores() {
  return {
    blocklist: {
      readConfig: async () => ({ botUserId: "bot-1", guilds: {} }),
    },
    timedRoles: {
      listTimedRolesByGuild: async () => [],
    },
    tickets: {
      readTicketPanelConfig: async () => null,
    },
  } as never;
}
