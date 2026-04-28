/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { TimedRoleService } from "../src/services/timed-role-service";
import { assignTimedRole } from "../src/services/timed-roles/assign-timed-role";
import type { TimedRoleStore } from "../src/runtime/contracts";
import type { TimedRoleAssignment } from "../src/types";

test("TimedRoleService.assignTimedRole persists role and assigns via Discord", async () => {
  const upsertedRoles: TimedRoleAssignment[] = [];
  const assignedRoles: Array<{ guildId: string; userId: string; roleId: string }> = [];

  const store: TimedRoleStore = {
    async upsertTimedRole(role: TimedRoleAssignment) {
      upsertedRoles.push(role);
    },
    async deleteTimedRole() {},
    async listTimedRoles() {
      return [];
    },
    async listTimedRolesByGuild() {
      return [];
    },
    async listExpiredTimedRoles() {
      return [];
    },
  };

  const service = new TimedRoleService(
    store,
    "bot-token",
    async (guildId: string, userId: string, roleId: string) => {
      assignedRoles.push({ guildId, userId, roleId });
    }
  );

  await service.assignTimedRole({
    guildId: "guild-1",
    userId: "user-1",
    roleId: "role-1",
    durationInput: "1h",
    expiresAtMs: Date.now() + 3600000,
  });

  assert.equal(upsertedRoles.length, 1);
  assert.equal(assignedRoles.length, 1);
  assert.deepEqual(assignedRoles[0], { guildId: "guild-1", userId: "user-1", roleId: "role-1" });
});

test("TimedRoleService.assignTimedRole rolls back database when Discord role assignment fails", async () => {
  const upsertedRoles: TimedRoleAssignment[] = [];
  const deletedRoles: Array<{ guildId: string; userId: string; roleId: string }> = [];

  const store: TimedRoleStore = {
    async upsertTimedRole(role: TimedRoleAssignment) {
      upsertedRoles.push(role);
    },
    async deleteTimedRole(key: { guildId: string; userId: string; roleId: string }) {
      deletedRoles.push(key);
    },
    async listTimedRoles() {
      return [];
    },
    async listTimedRolesByGuild() {
      return [];
    },
    async listExpiredTimedRoles() {
      return [];
    },
  };

  const service = new TimedRoleService(
    store,
    "bot-token",
    async () => {
      throw new Error("Discord API failed");
    }
  );

  await assert.rejects(
    async () =>
      service.assignTimedRole({
        guildId: "guild-1",
        userId: "user-1",
        roleId: "role-1",
        durationInput: "1h",
        expiresAtMs: Date.now() + 3600000,
      }),
    /Discord API failed/
  );

  assert.equal(upsertedRoles.length, 1, "Role should be persisted before Discord call");
  assert.equal(deletedRoles.length, 1, "Role should be deleted after Discord failure");
  assert.deepEqual(deletedRoles[0], { guildId: "guild-1", userId: "user-1", roleId: "role-1" });
});

test("TimedRoleService.removeTimedRole removes from Discord then deletes from database", async () => {
  const deletedRoles: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const removedRoles: Array<{ guildId: string; userId: string; roleId: string }> = [];

  const store: TimedRoleStore = {
    async deleteTimedRole(key: { guildId: string; userId: string; roleId: string }) {
      deletedRoles.push(key);
    },
    async upsertTimedRole() {},
    async listTimedRoles() {
      return [];
    },
    async listTimedRolesByGuild() {
      return [];
    },
    async listExpiredTimedRoles() {
      return [];
    },
  };

  const service = new TimedRoleService(
    store,
    "bot-token",
    undefined,
    async (guildId: string, userId: string, roleId: string) => {
      removedRoles.push({ guildId, userId, roleId });
    }
  );

  await service.removeTimedRole({
    guildId: "guild-1",
    userId: "user-1",
    roleId: "role-1",
  });

  assert.equal(removedRoles.length, 1, "Should remove from Discord first");
  assert.equal(deletedRoles.length, 1, "Should delete from database after Discord removal");
  assert.deepEqual(deletedRoles[0], { guildId: "guild-1", userId: "user-1", roleId: "role-1" });
});

test("assignTimedRole rolls back persisted state when the Discord add fails", async () => {
  const calls: string[] = [];

  await assert.rejects(
    assignTimedRole(
      {
        upsertTimedRole: async () => {
          calls.push("upsert");
        },
        deleteTimedRole: async () => {
          calls.push("rollback");
        },
      },
      async () => {
        throw new Error("discord failed");
      },
      {
        guildId: "guild",
        userId: "user",
        roleId: "role",
        durationInput: "1h",
        expiresAtMs: 123,
      }
    ),
    /discord failed/
  );

  assert.deepEqual(calls, ["upsert", "rollback"]);
});
