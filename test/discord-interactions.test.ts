/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  ADMINISTRATOR_PERMISSION,
  MANAGE_GUILD_PERMISSION,
  type CommandInvocation,
  hasGuildAdminPermission,
  extractCommandInvocation,
  buildEphemeralMessage,
} from "../src/discord-interactions";
import { SLASH_COMMAND_DEFINITIONS } from "../src/discord-commands";

type IsExact<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? (<T>() => T extends B ? 1 : 2) extends <T>() => T extends A ? 1 : 2
      ? true
      : false
    : false;

function expectTrue<T extends true>(_value: T) {}

expectTrue<IsExact<ReturnType<typeof extractCommandInvocation>, CommandInvocation | null>>(true);

test("hasGuildAdminPermission accepts Administrator and Manage Guild", () => {
  assert.equal(hasGuildAdminPermission(ADMINISTRATOR_PERMISSION.toString()), true);
  assert.equal(hasGuildAdminPermission(MANAGE_GUILD_PERMISSION.toString()), true);
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

test("extractCommandInvocation returns timedrole add/remove/list requests", () => {
  assert.deepEqual(
    extractCommandInvocation({
      data: {
        name: "timedrole",
        options: [
          {
            name: "add",
            type: 1,
            options: [
              { name: "user", value: "user-1" },
              { name: "role", value: "role-1" },
              { name: "duration", value: "1w" },
            ],
          },
        ],
      },
    } as any),
    {
      commandName: "timedrole",
      subcommandName: "add",
      userId: "user-1",
      roleId: "role-1",
      duration: "1w",
    },
  );

  assert.deepEqual(
    extractCommandInvocation({
      data: {
        name: "timedrole",
        options: [
          {
            name: "remove",
            type: 1,
            options: [
              { name: "user", value: "user-1" },
              { name: "role", value: "role-1" },
            ],
          },
        ],
      },
    } as any),
    {
      commandName: "timedrole",
      subcommandName: "remove",
      userId: "user-1",
      roleId: "role-1",
    },
  );

  assert.deepEqual(
    extractCommandInvocation({
      data: { name: "timedrole", options: [{ name: "list", type: 1 }] },
    } as any),
    {
      commandName: "timedrole",
      subcommandName: "list",
    },
  );
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

test("extractCommandInvocation rejects future commands with timedrole-shaped options", () => {
  SLASH_COMMAND_DEFINITIONS.push({
    name: "futurecommand",
    description: "Future command",
    options: [
      {
        type: 1,
        name: "add",
        description: "Add",
        options: [
          { type: 6, name: "user", description: "User", required: true },
          { type: 8, name: "role", description: "Role", required: true },
          { type: 3, name: "duration", description: "Duration", required: true },
        ],
      },
    ],
  });

  try {
    assert.equal(
      extractCommandInvocation({
        data: {
          name: "futurecommand",
          options: [
            {
              name: "add",
              type: 1,
              options: [
                { name: "user", value: "user-1" },
                { name: "role", value: "role-1" },
                { name: "duration", value: "1w" },
              ],
            },
          ],
        },
      } as any),
      null,
    );
  } finally {
    SLASH_COMMAND_DEFINITIONS.pop();
  }
});

test("extractCommandInvocation rejects non-string emoji values", () => {
  const nonStringEmoji = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "add",
          type: 1,
          options: [{ name: "emoji", value: { raw: "💀" } }],
        },
      ],
    },
  } as any;

  assert.equal(extractCommandInvocation(nonStringEmoji), null);
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
          options: [{ type: 3, name: "emoji", description: "Emoji to block", required: true }],
        },
        {
          type: 1,
          name: "remove",
          description: "Unblock an emoji in this server",
          options: [{ type: 3, name: "emoji", description: "Emoji to unblock", required: true }],
        },
        {
          type: 1,
          name: "list",
          description: "List the emojis blocked in this server",
        },
      ],
    },
    {
      name: "timedrole",
      description: "Manage timed role assignments in this server",
      options: [
        {
          type: 1,
          name: "add",
          description: "Assign a role to a user for a limited duration",
          options: [
            { type: 6, name: "user", description: "User to assign the role to", required: true },
            { type: 8, name: "role", description: "Role to assign", required: true },
            {
              type: 3,
              name: "duration",
              description: "How long to keep the role (for example 1h, 1w, 1m)",
              required: true,
            },
          ],
        },
        {
          type: 1,
          name: "remove",
          description: "Remove a timed role assignment from a user",
          options: [
            { type: 6, name: "user", description: "User to remove the role from", required: true },
            { type: 8, name: "role", description: "Role to remove", required: true },
          ],
        },
        {
          type: 1,
          name: "list",
          description: "List timed role assignments in this server",
        },
      ],
    },
    {
      name: "marketplace",
      description: "Manage this server's marketplace",
      options: [
        {
          type: 1,
          name: "setup",
          description: "Post or reset the marketplace noticeboard in this channel",
        },
        {
          type: 1,
          name: "logs",
          description: "View recent marketplace business logs",
          options: [
            {
              type: 4,
              name: "amount",
              description: "Number of logs to show (1-20)",
              required: false,
              min_value: 1,
              max_value: 20,
            },
          ],
        },
      ],
    },
  ];

  assert.deepEqual(SLASH_COMMAND_DEFINITIONS, expected);
});

test("SLASH_COMMAND_DEFINITIONS includes the blocklist list subcommand", () => {
  assert.deepEqual(
    SLASH_COMMAND_DEFINITIONS[0].options?.map((option) => option.name),
    ["add", "remove", "list"],
  );
});

test("extractCommandInvocation returns a list invocation without an emoji", () => {
  const interaction = {
    data: {
      name: "blocklist",
      options: [
        {
          name: "list",
          type: 1,
        },
      ],
    },
  };

  assert.deepEqual(extractCommandInvocation(interaction), {
    commandName: "blocklist",
    subcommandName: "list",
  });
});

test("buildEphemeralMessage returns the Discord ephemeral response shape", () => {
  const msg = buildEphemeralMessage("Hello");
  assert.deepEqual(msg, { type: 4, data: { content: "Hello", flags: 64 } });
});
