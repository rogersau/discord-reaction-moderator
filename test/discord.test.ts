/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  addGuildMemberRole,
  createTicketChannel,
  removeGuildMemberRole,
  uploadTranscriptToChannel,
} from "../src/discord";
import { listBotGuilds } from "../src/discord/guilds";
import { createTicketChannel as createTicketChannelFromChannels } from "../src/discord/channels";

test("addGuildMemberRole uses the Discord member-role endpoint", async () => {
  const calls: Array<{ input: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), method: init?.method ?? "GET" });
    return new Response(null, { status: 204 });
  };

  try {
    await addGuildMemberRole("guild-1", "user-1", "role-1", "bot-token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
      method: "PUT",
    },
  ]);
});

test("removeGuildMemberRole uses the Discord member-role endpoint", async () => {
  const calls: Array<{ input: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ input: String(input), method: init?.method ?? "GET" });
    return new Response(null, { status: 204 });
  };

  try {
    await removeGuildMemberRole("guild-1", "user-1", "role-1", "bot-token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
      method: "DELETE",
    },
  ]);
});

test("removeGuildMemberRole throws on Discord API failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });

  try {
    await assert.rejects(
      removeGuildMemberRole("guild-1", "user-1", "role-1", "bot-token"),
      /Discord API error: 500/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removeGuildMemberRole throws when Discord returns a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    ({
      ok: false,
      status: 204,
      text: async () => "unexpected",
    }) as Response;

  try {
    await assert.rejects(
      removeGuildMemberRole("guild-1", "user-1", "role-1", "bot-token"),
      /Discord API error: 204 unexpected/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createTicketChannel posts a private guild channel with opener and support overwrites", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json({ id: "ticket-channel-1" });
  }) as typeof fetch;

  try {
    await createTicketChannel(
      {
        guildId: "guild-1",
        name: "appeal-user-1",
        parentId: "category-1",
        botUserId: "bot-user-1",
        openerUserId: "user-1",
        supportRoleId: "role-1",
      },
      "bot-token",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    {
      url: "https://discord.com/api/v10/guilds/guild-1/channels",
      method: "POST",
      body: {
        name: "appeal-user-1",
        type: 0,
        parent_id: "category-1",
        permission_overwrites: [
          { id: "guild-1", type: 0, deny: "1024", allow: "0" },
          { id: "bot-user-1", type: 1, allow: "1024", deny: "0" },
          { id: "user-1", type: 1, allow: "1024", deny: "0" },
          { id: "role-1", type: 0, allow: "1024", deny: "0" },
        ],
      },
    },
  ]);
});

test("uploadTranscriptToChannel includes the HTML transcript link in the payload when provided", async () => {
  const calls: Array<{ url: string; method: string; body: FormData | null }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body instanceof FormData ? init.body : null,
    });
    return Response.json({ id: "transcript-message-1", channel_id: "channel-1", content: "" });
  }) as typeof fetch;

  try {
    await uploadTranscriptToChannel("channel-1", "ticket-123.txt", "ticket body", "bot-token", {
      htmlTranscriptUrl: "https://runtime.example/transcripts/guild-1/channel-1",
      embeds: [
        {
          title: "Ticket Transcript",
          fields: [{ name: "Messages", value: "2", inline: true }],
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://discord.com/api/v10/channels/channel-1/messages");
  assert.equal(calls[0]?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.body?.get("payload_json"))), {
    content: "HTML transcript: https://runtime.example/transcripts/guild-1/channel-1",
    embeds: [
      {
        title: "Ticket Transcript",
        fields: [{ name: "Messages", value: "2", inline: true }],
      },
    ],
    attachments: [{ id: 0, filename: "ticket-123.txt" }],
  });
  const transcriptFile = calls[0]?.body?.get("files[0]");
  assert.ok(transcriptFile instanceof File);
  assert.equal(await transcriptFile.text(), "ticket body");
});

test("listBotGuilds maps Discord guild payload through the guild client", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify([{ id: "1", name: "Guild One" }]), { status: 200 });

  try {
    const guilds = await listBotGuilds("token");
    assert.deepEqual(guilds, [{ guildId: "1", name: "Guild One" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createTicketChannel sends the expected Discord channel payload", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    return new Response(JSON.stringify({ id: "new-channel" }), { status: 200 });
  };

  try {
    const created = await createTicketChannelFromChannels(
      {
        guildId: "guild-1",
        name: "support-001",
        parentId: "parent-1",
        botUserId: "bot-1",
        openerUserId: "user-1",
        supportRoleId: "role-1",
      },
      "token",
    );

    assert.equal(created.id, "new-channel");
    assert.equal(calls[0]?.url, "https://discord.com/api/v10/guilds/guild-1/channels");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
