/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import worker from "../src/index";
import { buildEphemeralMessage } from "../src/discord-interactions";
import { formatTimedRoleExpiry } from "../src/timed-roles";

test("worker answers Discord PING interactions", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest({ type: 1 });

  const response = await worker.fetch(
    request,
    createEnv({ DISCORD_PUBLIC_KEY: publicKeyHex }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { type: 1 });
});

test("worker rejects interactions with an invalid Discord signature", async () => {
  const { publicKeyHex, bodyText, timestamp } = await createSignedInteractionRequestBody({
    type: 1,
  });

  const response = await worker.fetch(
    new Request("https://worker.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": "00".repeat(64),
        "x-signature-timestamp": timestamp,
      },
      body: bodyText,
    }),
    createEnv({ DISCORD_PUBLIC_KEY: publicKeyHex }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
});

test("worker rejects interactions with a stale Discord timestamp", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    { type: 1 },
    { timestamp: String(Math.floor(Date.now() / 1000) - 3600) }
  );

  const response = await worker.fetch(
    request,
    createEnv({ DISCORD_PUBLIC_KEY: publicKeyHex }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 401);
  assert.equal(await response.text(), "Unauthorized");
});

test("worker rejects slash commands from members without guild admin permissions", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "0",
      subcommand: "add",
      emoji: "✅",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({ ok: true });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), buildEphemeralMessage(
    "You need Administrator or Manage Guild permissions to use this command."
  ));
  assert.deepEqual(storeCalls, []);
});

test("worker forwards valid guild admin add and remove slash commands to the moderation store", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const blockedEmojis = new Set<string>();
  const env = createEnv({
    moderationFetch(input, init) {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      storeCalls.push({
        input: String(input),
        method,
        body,
      });

      if (method === "GET") {
        return Response.json({
          emojis: [],
          guilds: blockedEmojis.size
            ? {
                "guild-123": {
                  enabled: true,
                  emojis: [...blockedEmojis],
                },
              }
            : {},
          botUserId: "",
        });
      }

      if (body && typeof body === "object" && "action" in body && "emoji" in body) {
        if (body.action === "add") {
          blockedEmojis.add(String(body.emoji));
        } else if (body.action === "remove") {
          blockedEmojis.delete(String(body.emoji));
        }
      }

      return Response.json({ ok: true });
    },
  });

  const addRequest = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "add",
      emoji: "✅",
    })
  );
  env.DISCORD_PUBLIC_KEY = addRequest.publicKeyHex;

  const addResponse = await worker.fetch(addRequest.request, env, {} as ExecutionContext);

  const removeRequest = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "remove",
      emoji: "✅",
    })
  );
  env.DISCORD_PUBLIC_KEY = removeRequest.publicKeyHex;

  const removeResponse = await worker.fetch(
    removeRequest.request,
    env,
    {} as ExecutionContext
  );

  assert.equal(addResponse.status, 200);
  assert.deepEqual(await addResponse.json(), buildEphemeralMessage("Blocked ✅ in this server."));
  assert.equal(removeResponse.status, 200);
  assert.deepEqual(
    await removeResponse.json(),
    buildEphemeralMessage("Unblocked ✅ in this server.")
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
    {
      input: "https://moderation-store/guild-emoji",
      method: "POST",
      body: { guildId: "guild-123", emoji: "✅", action: "add" },
    },
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
    {
      input: "https://moderation-store/guild-emoji",
      method: "POST",
      body: { guildId: "guild-123", emoji: "✅", action: "remove" },
    },
  ]);
});

test("worker returns duplicate add feedback without mutating the store", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "add",
      emoji: "✅",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {
            "guild-123": {
              enabled: true,
              emojis: ["✅"],
            },
          },
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("✅ is already blocked in this server.")
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker returns missing remove feedback without mutating the store", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "remove",
      emoji: "✅",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {},
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("✅ is not currently blocked in this server.")
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker normalizes custom emoji aliases before duplicate and missing checks", async () => {
  const duplicateCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const duplicateRequest = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "add",
      emoji: ":blobcat:",
    })
  );

  const duplicateResponse = await worker.fetch(
    duplicateRequest.request,
    createEnv({
      DISCORD_PUBLIC_KEY: duplicateRequest.publicKeyHex,
      moderationFetch(input, init) {
        duplicateCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {
            "guild-123": {
              enabled: true,
              emojis: ["blobcat"],
            },
          },
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(duplicateResponse.status, 200);
  assert.deepEqual(
    await duplicateResponse.json(),
    buildEphemeralMessage(":blobcat: is already blocked in this server.")
  );
  assert.deepEqual(duplicateCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);

  const missingCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const missingRequest = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "remove",
      emoji: ":blobcat:",
    })
  );

  const missingResponse = await worker.fetch(
    missingRequest.request,
    createEnv({
      DISCORD_PUBLIC_KEY: missingRequest.publicKeyHex,
      moderationFetch(input, init) {
        missingCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {},
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(missingResponse.status, 200);
  assert.deepEqual(
    await missingResponse.json(),
    buildEphemeralMessage(":blobcat: is not currently blocked in this server.")
  );
  assert.deepEqual(missingCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker returns an ephemeral failure when moderation store forwarding throws", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "add",
      emoji: "✅",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch() {
        throw new Error("store unavailable");
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("Failed to update the server blocklist.")
  );
});

test("worker returns the empty state for /blocklist list when no emojis are blocked", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {},
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("No emojis are blocked in this server.")
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker returns the current server blocklist for /blocklist list", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({
          emojis: [],
          guilds: {
            "guild-123": {
              enabled: true,
              emojis: ["✅", "🍎"],
            },
          },
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), buildEphemeralMessage("Blocked emojis in this server:\n- ✅\n- 🍎"));
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/config",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker ignores legacy top-level blocklist entries for /blocklist list", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch() {
        return Response.json({
          emojis: ["🏳️‍🌈", "🍎"],
          guilds: {},
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("No emojis are blocked in this server.")
  );
});

test("worker truncates oversized /blocklist list responses to Discord's message limit", async () => {
  const oversizedGuildBlocklist = Array.from({ length: 400 }, (_, index) =>
    `custom-emoji-${String(index).padStart(3, "0")}`
  );
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createApplicationCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch() {
        return Response.json({
          emojis: [],
          guilds: {
            "guild-123": {
              enabled: true,
              emojis: oversizedGuildBlocklist,
            },
          },
          botUserId: "",
        });
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as ReturnType<typeof buildEphemeralMessage>;
  assert.deepEqual(body.type, 4);
  assert.equal(body.data.flags, 64);
  assert.ok(body.data.content.startsWith("Blocked emojis in this server:\n- custom-emoji-000"));
  assert.ok(body.data.content.includes("\n...and "));
  assert.ok(body.data.content.length <= 2000);
});

test("worker assigns a timed role for a valid guild admin command", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];

  await withMockedFetch(
    async () => new Response(null, { status: 204 }),
    async () => {
      const { publicKeyHex, request } = await createSignedInteractionRequest(
        createTimedRoleCommand({
          guildId: "guild-123",
          permissions: "8",
          subcommand: "add",
          userId: "user-1",
          roleId: "role-1",
          duration: "1w",
        })
      );

      const response = await worker.fetch(
        request,
        createEnv({
          DISCORD_PUBLIC_KEY: publicKeyHex,
          moderationFetch(input, init) {
            storeCalls.push({
              input: String(input),
              method: init?.method ?? "GET",
              body: init?.body ? JSON.parse(String(init.body)) : null,
            });
            return Response.json({ ok: true });
          },
        }),
        {} as ExecutionContext
      );

      assert.equal(response.status, 200);
      const expiresAtMs =
        storeCalls[0] && typeof storeCalls[0].body === "object"
          ? (storeCalls[0].body as { expiresAtMs: number }).expiresAtMs
          : undefined;
      assert.deepEqual(
        await response.json(),
        buildEphemeralMessage(
          `Assigned <@&role-1> to <@user-1> for 1w (${formatTimedRoleExpiry(expiresAtMs as number)}).`
        )
      );
    }
  );

  assert.equal(storeCalls[0]?.input, "https://moderation-store/timed-role");
  assert.equal(storeCalls[0]?.method, "POST");
  assert.deepEqual(storeCalls[0]?.body, {
    guildId: "guild-123",
    userId: "user-1",
    roleId: "role-1",
    durationInput: "1w",
    expiresAtMs: storeCalls[0] && typeof storeCalls[0].body === "object"
      ? (storeCalls[0].body as { expiresAtMs: number }).expiresAtMs
      : undefined,
  });
  assert.equal(typeof (storeCalls[0]?.body as { expiresAtMs?: unknown })?.expiresAtMs, "number");
});

test("worker rejects invalid timed-role durations", async () => {
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createTimedRoleCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "add",
      userId: "user-1",
      roleId: "role-1",
      duration: "tomorrow",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({ DISCORD_PUBLIC_KEY: publicKeyHex }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("Invalid duration. Use values like 1h, 1w, or 1m.")
  );
});

test("worker rolls back timed role persistence when Discord role assignment fails", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];

  await withMockedFetch(
    async () => new Response("discord unavailable", { status: 500 }),
    async () => {
      const { publicKeyHex, request } = await createSignedInteractionRequest(
        createTimedRoleCommand({
          guildId: "guild-123",
          permissions: "8",
          subcommand: "add",
          userId: "user-1",
          roleId: "role-1",
          duration: "1w",
        })
      );

      const response = await worker.fetch(
        request,
        createEnv({
          DISCORD_PUBLIC_KEY: publicKeyHex,
          moderationFetch(input, init) {
            storeCalls.push({
              input: String(input),
              method: init?.method ?? "GET",
              body: init?.body ? JSON.parse(String(init.body)) : null,
            });
            return Response.json({ ok: true });
          },
        }),
        {} as ExecutionContext
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        await response.json(),
        buildEphemeralMessage("Failed to assign the timed role.")
      );
    }
  );

  assert.deepEqual(
    storeCalls.map((call) => ({ input: call.input, method: call.method })),
    [
      { input: "https://moderation-store/timed-role", method: "POST" },
      { input: "https://moderation-store/timed-role/remove", method: "POST" },
    ]
  );
});

test("worker reports rollback failure when timed role cleanup cannot be persisted", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];

  await withMockedFetch(
    async () => new Response("discord unavailable", { status: 500 }),
    async () => {
      const { publicKeyHex, request } = await createSignedInteractionRequest(
        createTimedRoleCommand({
          guildId: "guild-123",
          permissions: "8",
          subcommand: "add",
          userId: "user-1",
          roleId: "role-1",
          duration: "1w",
        })
      );

      let postCount = 0;
      const response = await worker.fetch(
        request,
        createEnv({
          DISCORD_PUBLIC_KEY: publicKeyHex,
          moderationFetch(input, init) {
            const method = init?.method ?? "GET";
            const body = init?.body ? JSON.parse(String(init.body)) : null;
            storeCalls.push({
              input: String(input),
              method,
              body,
            });
            postCount += method === "POST" ? 1 : 0;

            if (postCount === 2) {
              return new Response("rollback failed", { status: 500 });
            }

            return Response.json({ ok: true });
          },
        }),
        {} as ExecutionContext
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        await response.json(),
        buildEphemeralMessage("Failed to assign the timed role, and rollback failed.")
      );
    }
  );

  assert.deepEqual(
    storeCalls.map((call) => ({ input: call.input, method: call.method })),
    [
      { input: "https://moderation-store/timed-role", method: "POST" },
      { input: "https://moderation-store/timed-role/remove", method: "POST" },
    ]
  );
});

test("worker removes an active timed role assignment", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const discordCalls: Array<{ input: string; method: string | undefined }> = [];

  await withMockedFetch(
    async (input, init) => {
      discordCalls.push({ input: String(input), method: init?.method });
      return new Response(null, { status: 204 });
    },
    async () => {
      const { publicKeyHex, request } = await createSignedInteractionRequest(
        createTimedRoleCommand({
          guildId: "guild-123",
          permissions: "8",
          subcommand: "remove",
          userId: "user-1",
          roleId: "role-1",
        })
      );

      const response = await worker.fetch(
        request,
        createEnv({
          DISCORD_PUBLIC_KEY: publicKeyHex,
          moderationFetch(input, init) {
            storeCalls.push({
              input: String(input),
              method: init?.method ?? "GET",
              body: init?.body ? JSON.parse(String(init.body)) : null,
            });

            if ((init?.method ?? "GET") === "GET") {
              return Response.json([
                {
                  guildId: "guild-123",
                  userId: "user-1",
                  roleId: "role-1",
                  durationInput: "1w",
                  expiresAtMs: 1_700_604_800_000,
                },
              ]);
            }

            return Response.json({ ok: true });
          },
        }),
        {} as ExecutionContext
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        await response.json(),
        buildEphemeralMessage("Removed <@&role-1> from <@user-1>.")
      );
    }
  );

  assert.deepEqual(
    storeCalls.map((call) => ({ input: call.input, method: call.method })),
    [
      {
        input: "https://moderation-store/timed-roles?guildId=guild-123",
        method: "GET",
      },
      {
        input: "https://moderation-store/timed-role/remove",
        method: "POST",
      },
    ]
  );
  assert.deepEqual(discordCalls, [
    {
      input: "https://discord.com/api/v10/guilds/guild-123/members/user-1/roles/role-1",
      method: "DELETE",
    },
  ]);
});

test("worker returns a no-op response when the timed role assignment is not active", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const discordCalls: Array<{ input: string; method: string | undefined }> = [];

  await withMockedFetch(
    async (input, init) => {
      discordCalls.push({ input: String(input), method: init?.method });
      return new Response(null, { status: 204 });
    },
    async () => {
      const { publicKeyHex, request } = await createSignedInteractionRequest(
        createTimedRoleCommand({
          guildId: "guild-123",
          permissions: "8",
          subcommand: "remove",
          userId: "user-1",
          roleId: "role-1",
        })
      );

      const response = await worker.fetch(
        request,
        createEnv({
          DISCORD_PUBLIC_KEY: publicKeyHex,
          moderationFetch(input, init) {
            storeCalls.push({
              input: String(input),
              method: init?.method ?? "GET",
              body: init?.body ? JSON.parse(String(init.body)) : null,
            });
            return Response.json([]);
          },
        }),
        {} as ExecutionContext
      );

      assert.equal(response.status, 200);
      assert.deepEqual(
        await response.json(),
        buildEphemeralMessage("<@&role-1> is not currently active for <@user-1>.")
      );
    }
  );

  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/timed-roles?guildId=guild-123",
      method: "GET",
      body: null,
    },
  ]);
  assert.deepEqual(discordCalls, []);
});

test("worker returns the current timed role assignments for /timedrole list", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createTimedRoleCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json([
          {
            guildId: "guild-123",
            userId: "user-1",
            roleId: "role-1",
            durationInput: "1w",
            expiresAtMs: 1_700_604_800_000,
          },
          {
            guildId: "guild-123",
            userId: "user-2",
            roleId: "role-2",
            durationInput: "2h",
            expiresAtMs: 1_700_007_200_000,
          },
        ]);
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage(
      "Active timed roles:\n- <@user-1> -> <@&role-1> (1w, expires <t:1700604800:R>)\n- <@user-2> -> <@&role-2> (2h, expires <t:1700007200:R>)"
    )
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/timed-roles?guildId=guild-123",
      method: "GET",
      body: null,
    },
  ]);
});

test("worker returns the empty state for /timedrole list when no assignments are active", async () => {
  const storeCalls: Array<{ input: string; method: string; body: unknown }> = [];
  const { publicKeyHex, request } = await createSignedInteractionRequest(
    createTimedRoleCommand({
      guildId: "guild-123",
      permissions: "8",
      subcommand: "list",
    })
  );

  const response = await worker.fetch(
    request,
    createEnv({
      DISCORD_PUBLIC_KEY: publicKeyHex,
      moderationFetch(input, init) {
        storeCalls.push({
          input: String(input),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json([]);
      },
    }),
    {} as ExecutionContext
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    await response.json(),
    buildEphemeralMessage("No timed roles are active in this server.")
  );
  assert.deepEqual(storeCalls, [
    {
      input: "https://moderation-store/timed-roles?guildId=guild-123",
      method: "GET",
      body: null,
    },
  ]);
});

function createApplicationCommand(
  options:
    | { guildId: string; permissions: string; subcommand: "add" | "remove"; emoji: string }
    | { guildId: string; permissions: string; subcommand: "list" }
) {
  const subOptions =
    options.subcommand === "list"
      ? []
      : [{ type: 3, name: "emoji", value: options.emoji }];

  return {
    type: 2,
    guild_id: options.guildId,
    member: {
      permissions: options.permissions,
    },
    data: {
      name: "blocklist",
      options: [
        {
          type: 1,
          name: options.subcommand,
          options: subOptions,
        },
      ],
    },
  };
}

function createTimedRoleCommand(
  options:
    | {
        guildId: string;
        permissions: string;
        subcommand: "add";
        userId: string;
        roleId: string;
        duration: string;
      }
    | {
        guildId: string;
        permissions: string;
        subcommand: "remove";
        userId: string;
        roleId: string;
      }
    | { guildId: string; permissions: string; subcommand: "list" }
) {
  const subOptions =
    options.subcommand === "list"
      ? []
      : [
          { type: 6, name: "user", value: options.userId },
          { type: 8, name: "role", value: options.roleId },
          ...(options.subcommand === "add"
            ? [{ type: 3, name: "duration", value: options.duration }]
            : []),
        ];

  return {
    type: 2,
    guild_id: options.guildId,
    member: {
      permissions: options.permissions,
    },
    data: {
      name: "timedrole",
      options: [
        {
          type: 1,
          name: options.subcommand,
          options: subOptions,
        },
      ],
    },
  };
}

async function createSignedInteractionRequest(
  payload: unknown,
  options?: { timestamp?: string }
) {
  const { publicKeyHex, bodyText, timestamp, signatureHex } =
    await createSignedInteractionRequestBody(payload, options);

  return {
    publicKeyHex,
    request: new Request("https://worker.example/interactions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signatureHex,
        "x-signature-timestamp": timestamp,
      },
      body: bodyText,
    }),
  };
}

async function createSignedInteractionRequestBody(
  payload: unknown,
  options?: { timestamp?: string }
) {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const timestamp = options?.timestamp ?? String(Math.floor(Date.now() / 1000));
  const bodyText = JSON.stringify(payload);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    keyPair.privateKey,
    new TextEncoder().encode(`${timestamp}${bodyText}`)
  );
  const publicKey = (await crypto.subtle.exportKey(
    "raw",
    keyPair.publicKey
  )) as ArrayBuffer;

  return {
    publicKeyHex: toHex(new Uint8Array(publicKey)),
    bodyText,
    timestamp,
    signatureHex: toHex(new Uint8Array(signature)),
  };
}

function createEnv(options?: {
  DISCORD_PUBLIC_KEY?: string;
  moderationFetch?: (input: Request | string | URL, init?: RequestInit) => Response;
}) {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    DISCORD_PUBLIC_KEY: options?.DISCORD_PUBLIC_KEY ?? "",
    MODERATION_STORE_DO: {
      idFromName() {
        return "moderation-store-id" as never;
      },
      get() {
        return {
          fetch: async (input: Request | string | URL, init?: RequestInit) =>
            options?.moderationFetch?.(input, init) ??
            Response.json({ emojis: [], guilds: {}, botUserId: "" }),
        };
      },
    } as never,
    GATEWAY_SESSION_DO: {
      idFromName() {
        return "gateway-session-id" as never;
      },
      get() {
        return {
          fetch: async () => Response.json({ status: "idle" }),
        };
      },
    } as never,
  } as {
    DISCORD_BOT_TOKEN: string;
    BOT_USER_ID: string;
    DISCORD_PUBLIC_KEY: string;
    MODERATION_STORE_DO: DurableObjectNamespace;
    GATEWAY_SESSION_DO: DurableObjectNamespace;
  };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function withMockedFetch<T>(
  handler: typeof globalThis.fetch,
  callback: () => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}
