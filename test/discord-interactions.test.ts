/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  ADMINISTRATOR_PERMISSION,
  MANAGE_GUILD_PERMISSION,
  hasGuildAdminPermission,
  extractCommandInvocation,
  buildEphemeralMessage,
} from "../src/discord-interactions";
import { SLASH_COMMAND_DEFINITIONS } from "../src/discord-commands";

test("hasGuildAdminPermission accepts Administrator and Manage Guild", () => {
  assert.equal(
    hasGuildAdminPermission(ADMINISTRATOR_PERMISSION.toString()),
    true
  );
  assert.equal(
    hasGuildAdminPermission(MANAGE_GUILD_PERMISSION.toString()),
    true
  );
  assert.equal(hasGuildAdminPermission("0"), false);
});

test("extractCommandInvocation returns blocklist add/remove requests", () => {
  const addInvocation = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "add",
          type: 1,
          options: [{ name: "emoji", value: "✅" }],
        },
      ],
    },
  } as any;

  const removeInvocation = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "remove",
          type: 1,
          options: [{ name: "emoji", value: "❌" }],
        },
      ],
    },
  } as any;

  assert.deepEqual(extractCommandInvocation(addInvocation), {
    commandName: "blocklist",
    subcommandName: "add",
    emoji: "✅",
  });

  assert.deepEqual(extractCommandInvocation(removeInvocation), {
    commandName: "blocklist",
    subcommandName: "remove",
    emoji: "❌",
  });

  assert.equal(extractCommandInvocation({} as any), null);
});

test("extractCommandInvocation rejects unknown commands and subcommands", () => {
  const bogusSub = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "bogus",
          type: 1,
          options: [{ name: "emoji", value: "💀" }],
        },
      ],
    },
  } as any;

  const unknownCmd = {
    data: {
      name: "unknown",
      options: [],
    },
  } as any;

  assert.equal(extractCommandInvocation(bogusSub), null);
  assert.equal(extractCommandInvocation(unknownCmd), null);
});

test("SLASH_COMMAND_DEFINITIONS matches expected blocklist command tree", () => {
  const expected = [
    {
      name: "blocklist",
      description: "Manage this server's blocked emoji list",
      options: [
        {
          type: 1,
          name: "add",
          description: "Block an emoji in this server",
          options: [
            { type: 3, name: "emoji", description: "Emoji to block", required: true },
          ],
        },
        {
          type: 1,
          name: "remove",
          description: "Unblock an emoji in this server",
          options: [
            { type: 3, name: "emoji", description: "Emoji to unblock", required: true },
          ],
        },
      ],
    },
  ];

  assert.deepEqual(SLASH_COMMAND_DEFINITIONS, expected);
});

test("buildEphemeralMessage returns the Discord ephemeral response shape", () => {
  const msg = buildEphemeralMessage("Hello");
  assert.deepEqual(msg, { type: 4, data: { content: "Hello", flags: 64 } });
});
