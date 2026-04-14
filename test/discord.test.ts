/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import { addGuildMemberRole, removeGuildMemberRole } from "../src/discord";

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

  assert.deepEqual(calls, [{
    input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
    method: "PUT",
  }]);
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

  assert.deepEqual(calls, [{
    input: "https://discord.com/api/v10/guilds/guild-1/members/user-1/roles/role-1",
    method: "DELETE",
  }]);
});

test("removeGuildMemberRole throws on Discord API failures", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("boom", { status: 500 });

  try {
    await assert.rejects(
      removeGuildMemberRole("guild-1", "user-1", "role-1", "bot-token"),
      /Discord API error: 500/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removeGuildMemberRole throws when Discord returns a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 204,
    text: async () => "unexpected",
  }) as Response;

  try {
    await assert.rejects(
      removeGuildMemberRole("guild-1", "user-1", "role-1", "bot-token"),
      /Discord API error: 204 unexpected/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
