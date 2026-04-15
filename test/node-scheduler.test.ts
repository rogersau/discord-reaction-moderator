/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createTimedRoleScheduler } from "../src/runtime/node-scheduler";

test("timed role scheduler removes expired roles and deletes successful rows", async () => {
  const removed: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const deleted: Array<{ guildId: string; userId: string; roleId: string }> = [];

  const scheduler = createTimedRoleScheduler({
    now: () => 1_700_000_000_000,
    store: {
      async listExpiredTimedRoles() {
        return [{
          guildId: "guild-1",
          userId: "user-1",
          roleId: "role-1",
          durationInput: "1h",
          expiresAtMs: 1_699_999_999_000,
        }];
      },
      async deleteTimedRole(body: any) {
        deleted.push(body);
      },
    } as any,
    removeGuildMemberRole: async (guildId: string, userId: string, roleId: string) => {
      removed.push({ guildId, userId, roleId });
    },
    setTimer(callback: any) {
      void callback();
      return { stop() {} };
    },
  });

  await scheduler.start();

  assert.deepEqual(removed, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
  assert.deepEqual(deleted, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
});
