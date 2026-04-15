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
    setTimer(_callback: any, _delayMs: number) {
      return { stop() {} };
    },
  });

  await scheduler.start();

  assert.deepEqual(removed, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
  assert.deepEqual(deleted, [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }]);
});

test("timed role scheduler re-arms a one-shot timer after each tick", async () => {
  const removed: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const timerCallbacks: Array<() => void | Promise<void>> = [];
  const timerDelayMs: number[] = [];

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
      async deleteTimedRole() {},
    } as any,
    removeGuildMemberRole: async (guildId: string, userId: string, roleId: string) => {
      removed.push({ guildId, userId, roleId });
    },
    setTimer(callback: any, delayMs: number) {
      timerCallbacks.push(callback);
      timerDelayMs.push(delayMs);
      return { stop() {} };
    },
  });

  await scheduler.start();

  assert.equal(timerCallbacks.length, 1, "should install the first one-shot timer");
  assert.deepEqual(timerDelayMs, [1000], "timer should fire every 1000ms");
  assert.equal(removed.length, 1, "should process roles on start");

  await timerCallbacks[0]?.();
  assert.equal(removed.length, 2, "should process roles when timer fires");
  assert.equal(timerCallbacks.length, 2, "should re-arm a new one-shot timer after the first tick");

  await timerCallbacks[1]?.();
  assert.equal(removed.length, 3, "should continue processing on each timer tick");
  assert.equal(timerCallbacks.length, 3, "should keep re-arming after each tick");
});

test("timed role scheduler stop cancels the timer", async () => {
  let stopped = false;

  const scheduler = createTimedRoleScheduler({
    now: () => 1_700_000_000_000,
    store: {
      async listExpiredTimedRoles() {
        return [];
      },
      async deleteTimedRole() {},
    } as any,
    removeGuildMemberRole: async () => {},
    setTimer(_callback: any, _delayMs: number) {
      return { 
        stop() {
          stopped = true;
        }
      };
    },
  });

  await scheduler.start();
  scheduler.stop();

  assert.equal(stopped, true, "should call stop on the timer");
});

test("timed role scheduler skips overlapping timer passes while a prior run is still active", async () => {
  const removed: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const deleted: Array<{ guildId: string; userId: string; roleId: string }> = [];
  const timerCallbacks: Array<() => void | Promise<void>> = [];
  let resolveRemoval: (() => void) | undefined;
  const removalBarrier = new Promise<void>((resolve) => {
    resolveRemoval = resolve;
  });
  let listCalls = 0;

  const scheduler = createTimedRoleScheduler({
    now: () => 1_700_000_000_000,
    store: {
      async listExpiredTimedRoles() {
        listCalls += 1;
        if (listCalls === 1) {
          return [];
        }
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
      await removalBarrier;
    },
    setTimer(callback: any, _delayMs: number) {
      timerCallbacks.push(callback);
      return { stop() {} };
    },
  });

  await scheduler.start();
  assert.equal(timerCallbacks.length, 1, "should install the first one-shot timer");

  const firstTick = timerCallbacks[0]?.();
  assert.equal(timerCallbacks.length, 2, "the first tick should arm the next one-shot timer immediately");

  const secondTick = timerCallbacks[1]?.();

  resolveRemoval?.();

  await Promise.all([firstTick, secondTick]);

  assert.deepEqual(
    removed,
    [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }],
    "overlapping timer ticks should only remove each expired role once"
  );
  assert.deepEqual(
    deleted,
    [{ guildId: "guild-1", userId: "user-1", roleId: "role-1" }],
    "overlapping timer ticks should only delete each expired role once"
  );
  assert.equal(timerCallbacks.length, 3, "overlapping ticks should keep exactly one future timer armed");
});

test("timed role scheduler ignores stale timer callbacks after restart", async () => {
  const timerCallbacks: Array<() => void | Promise<void>> = [];
  const timers: Array<{ stopped: boolean }> = [];

  const scheduler = createTimedRoleScheduler({
    now: () => 1_700_000_000_000,
    store: {
      async listExpiredTimedRoles() {
        return [];
      },
      async deleteTimedRole() {},
    } as any,
    removeGuildMemberRole: async () => {},
    setTimer(callback: any, _delayMs: number) {
      const timer = { stopped: false };
      timers.push(timer);
      timerCallbacks.push(callback);
      return {
        stop() {
          timer.stopped = true;
        },
      };
    },
  });

  await scheduler.start();
  scheduler.stop();
  await scheduler.start();

  assert.equal(timerCallbacks.length, 2, "restart should replace the previous timer with one current timer");
  assert.equal(timers[0]?.stopped, true, "stop should cancel the original timer");

  await timerCallbacks[0]?.();

  assert.equal(
    timerCallbacks.length,
    2,
    "stale timer callbacks should not arm extra timers after restart"
  );
});
