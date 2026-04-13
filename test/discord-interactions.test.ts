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

test("SLASH_COMMAND_DEFINITIONS exposes the blocklist command tree", () => {
  const defs = SLASH_COMMAND_DEFINITIONS;
  const blk = defs.find((d) => d.name === "blocklist");
  assert.ok(blk);
  assert.equal(blk!.description.includes("blocked"), true);
  const optionNames = (blk!.options || []).map((o: any) => o.name);
  assert.ok(optionNames.includes("add") && optionNames.includes("remove"));
});

test("buildEphemeralMessage returns the Discord ephemeral response shape", () => {
  const msg = buildEphemeralMessage("Hello");
  assert.deepEqual(msg, { type: 4, data: { content: "Hello", flags: 64 } });
});
