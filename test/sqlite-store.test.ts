/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createSqliteRuntimeStore } from "../src/runtime/sqlite-store";

test("sqlite runtime store persists blocklist config and gateway session state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });
    await store.applyGuildEmojiMutation({ guildId: "guild-1", emoji: "✅", action: "add" });
    await store.writeGatewaySnapshot({
      status: "ready",
      sessionId: "session-1",
      resumeGatewayUrl: "wss://resume.discord.gg/?v=10&encoding=json",
      lastSequence: 42,
      backoffAttempt: 0,
      lastError: null,
      heartbeatIntervalMs: 45000,
    });

    const config = await store.readConfig();
    const snapshot = await store.readGatewaySnapshot();

    assert.deepEqual(config.guilds["guild-1"], { enabled: true, emojis: ["✅"] });
    assert.equal(snapshot.sessionId, "session-1");
    assert.equal(snapshot.lastSequence, 42);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite runtime store upserts and lists timed roles by guild", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 1000,
    });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-2",
      roleId: "role-2",
      durationInput: "2h",
      expiresAtMs: 2000,
    });

    await store.upsertTimedRole({
      guildId: "guild-2",
      userId: "user-3",
      roleId: "role-3",
      durationInput: "3h",
      expiresAtMs: 3000,
    });

    const guild1Roles = await store.listTimedRolesByGuild("guild-1");
    const guild2Roles = await store.listTimedRolesByGuild("guild-2");

    assert.equal(guild1Roles.length, 2);
    assert.equal(guild1Roles[0].userId, "user-1");
    assert.equal(guild1Roles[0].expiresAtMs, 1000);
    assert.equal(guild1Roles[1].userId, "user-2");
    assert.equal(guild1Roles[1].expiresAtMs, 2000);

    assert.equal(guild2Roles.length, 1);
    assert.equal(guild2Roles[0].userId, "user-3");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite runtime store replaces timed role on upsert conflict", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 1000,
    });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "2h",
      expiresAtMs: 2000,
    });

    const roles = await store.listTimedRolesByGuild("guild-1");

    assert.equal(roles.length, 1);
    assert.equal(roles[0].durationInput, "2h");
    assert.equal(roles[0].expiresAtMs, 2000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite runtime store deletes timed roles", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 1000,
    });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-2",
      roleId: "role-2",
      durationInput: "2h",
      expiresAtMs: 2000,
    });

    await store.deleteTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
    });

    const roles = await store.listTimedRolesByGuild("guild-1");

    assert.equal(roles.length, 1);
    assert.equal(roles[0].userId, "user-2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite runtime store lists expired timed roles with boundary case", async () => {
  const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
  const sqlitePath = join(dir, "runtime.sqlite");

  try {
    const store = createSqliteRuntimeStore({ sqlitePath, botUserId: "bot-user-id" });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-1",
      roleId: "role-1",
      durationInput: "1h",
      expiresAtMs: 1000,
    });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-2",
      roleId: "role-2",
      durationInput: "2h",
      expiresAtMs: 1500,
    });

    await store.upsertTimedRole({
      guildId: "guild-1",
      userId: "user-3",
      roleId: "role-3",
      durationInput: "3h",
      expiresAtMs: 2000,
    });

    const expiredAt1500 = await store.listExpiredTimedRoles(1500);
    assert.equal(expiredAt1500.length, 2);
    assert.equal(expiredAt1500[0].userId, "user-1");
    assert.equal(expiredAt1500[1].userId, "user-2");

    const expiredAt1499 = await store.listExpiredTimedRoles(1499);
    assert.equal(expiredAt1499.length, 1);
    assert.equal(expiredAt1499[0].userId, "user-1");

    const expiredAt3000 = await store.listExpiredTimedRoles(3000);
    assert.equal(expiredAt3000.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
