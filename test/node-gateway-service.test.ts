/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createNodeGatewayService } from "../src/runtime/node-gateway-service";

test("node gateway service identifies on HELLO and persists READY state", async () => {
  const sent: string[] = [];
  let onMessage: ((payload: string) => void) | undefined;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot(snapshot: any) {
      persisted = snapshot;
    },
  } as any;

  let persisted: any;
  globalThis.setInterval = (((_callback: () => void, _delayMs?: number) => {
    return { id: "heartbeat-interval" } as any;
  }) as typeof setInterval);
  globalThis.clearInterval = (((_token: unknown) => {}) as typeof clearInterval);

  try {
    const gateway = createNodeGatewayService({
      botToken: "bot-token",
      store,
      openWebSocket(_url: string, handlers: any) {
        onMessage = handlers.onMessage;
        return {
          send(data: string) {
            sent.push(data);
          },
          close() {},
        };
      },
      setTimer(_callback: any, _delayMs: number) {
        return { stop() {} };
      },
    });

    await gateway.start();
    onMessage?.(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
    onMessage?.(JSON.stringify({ op: 0, t: "READY", s: 7, d: { session_id: "session-7", resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json" } }));

    assert.equal(JSON.parse(sent[0] ?? "{}").op, 2);
    assert.equal(JSON.parse(sent[0] ?? "{}").d?.properties?.os, "node");
    assert.equal(persisted.sessionId, "session-7");
    assert.equal((await gateway.status()).status, "ready");
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("node gateway service schedules reconnect after websocket close", async () => {
  let onClose: (() => void) | undefined;
  let timerCallback: (() => void | Promise<void>) | undefined;
  let timerDelayMs: number | undefined;
  const openedUrls: string[] = [];

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot() {},
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(url: string, handlers: any) {
      openedUrls.push(url);
      onClose = handlers.onClose;
      return {
        send() {},
        close() {},
      };
    },
    setTimer(callback: any, delayMs: number) {
      timerCallback = callback;
      timerDelayMs = delayMs;
      return { stop() {} };
    },
  });

  await gateway.start();
  assert.equal(openedUrls.length, 1);

  onClose?.();
  assert.ok(timerCallback, "backoff timer should be scheduled after close");
  assert.equal(timerDelayMs, 1000, "first backoff should be 1000ms");

  await timerCallback?.();
  assert.equal(openedUrls.length, 2, "should reconnect after backoff timer fires");
});

test("node gateway service clears the heartbeat interval when the websocket closes", async () => {
  let onMessage: ((payload: string) => void) | undefined;
  let onClose: (() => void) | undefined;
  const intervalToken = { id: "heartbeat-interval" };
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const scheduledIntervals: Array<{ callback: () => void; delayMs: number }> = [];
  const clearedIntervals: unknown[] = [];

  globalThis.setInterval = (((callback: () => void, delayMs?: number) => {
    scheduledIntervals.push({ callback, delayMs: delayMs ?? 0 });
    return intervalToken as any;
  }) as typeof setInterval);
  globalThis.clearInterval = (((token: unknown) => {
    clearedIntervals.push(token);
  }) as typeof clearInterval);

  try {
    const store = {
      async readConfig() {
        return { guilds: {}, botUserId: "bot-user-id" };
      },
      async readGatewaySnapshot() {
        return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
      },
      async writeGatewaySnapshot() {},
    } as any;

    const gateway = createNodeGatewayService({
      botToken: "bot-token",
      store,
      openWebSocket(_url: string, handlers: any) {
        onMessage = handlers.onMessage;
        onClose = handlers.onClose;
        return {
          send() {},
          close() {},
        };
      },
      setTimer(_callback: any, _delayMs: number) {
        return { stop() {} };
      },
    });

    await gateway.start();
    onMessage?.(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));

    assert.equal(scheduledIntervals.length, 1, "HELLO should schedule a heartbeat interval");

    onClose?.();

    assert.deepEqual(
      clearedIntervals,
      [intervalToken],
      "closing the websocket should clear the active heartbeat interval"
    );
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test("node gateway service guards against duplicate start calls", async () => {
  const openedUrls: string[] = [];

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot() {},
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(url: string, _handlers: any) {
      openedUrls.push(url);
      return {
        send() {},
        close() {},
      };
    },
    setTimer(_callback: any, _delayMs: number) {
      return { stop() {} };
    },
  });

  await gateway.start();
  await gateway.start();
  await gateway.start();

  assert.equal(openedUrls.length, 1, "should only open one websocket despite multiple start calls");
});

test("node gateway service coalesces concurrent start calls into one websocket attempt", async () => {
  const openedUrls: string[] = [];
  const writeSnapshots: any[] = [];
  let releaseWrite: (() => void) | undefined;
  const writeBarrier = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot(snapshot: any) {
      writeSnapshots.push({ ...snapshot });
      await writeBarrier;
    },
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(url: string, _handlers: any) {
      openedUrls.push(url);
      return {
        send() {},
        close() {},
      };
    },
    setTimer(_callback: any, _delayMs: number) {
      return { stop() {} };
    },
  });

  const firstStart = gateway.start();
  const secondStart = gateway.start();

  await Promise.resolve();
  await Promise.resolve();

  releaseWrite?.();

  await Promise.all([firstStart, secondStart]);

  assert.equal(writeSnapshots.length, 1, "concurrent starts should share one persisted start attempt");
  assert.equal(openedUrls.length, 1, "concurrent starts should only open one websocket");
});

test("node gateway service handles readConfig failures on reaction dispatch without unhandled rejections", async () => {
  let onMessage: ((payload: string) => void) | undefined;
  let persisted: any;
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };

  const store = {
    async readConfig() {
      throw new Error("store unavailable");
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot(snapshot: any) {
      persisted = snapshot;
    },
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(_url: string, handlers: any) {
      onMessage = handlers.onMessage;
      return {
        send() {},
        close() {},
      };
    },
    setTimer(_callback: any, _delayMs: number) {
      return { stop() {} };
    },
  });

  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await gateway.start();
    onMessage?.(
      JSON.stringify({
        op: 0,
        t: "MESSAGE_REACTION_ADD",
        d: {
          channel_id: "channel-1",
          message_id: "message-1",
          guild_id: "guild-1",
          emoji: { id: null, name: "✅", animated: false },
          user_id: "user-1",
        },
      })
    );

    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      unhandledRejections,
      [],
      "reaction dispatch config failures should not escape as unhandled rejections"
    );
    assert.equal(persisted?.lastError, "Failed to load moderation config");
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("node gateway service handles snapshot persistence failures without unhandled rejections", async () => {
  let onError: (() => void) | undefined;
  const unhandledRejections: unknown[] = [];
  const onUnhandledRejection = (reason: unknown) => {
    unhandledRejections.push(reason);
  };
  let writeCount = 0;

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot() {
      writeCount += 1;
      if (writeCount > 1) {
        throw new Error("disk full");
      }
    },
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(_url: string, handlers: any) {
      onError = handlers.onError;
      return {
        send() {},
        close() {},
      };
    },
    setTimer(_callback: any, _delayMs: number) {
      return { stop() {} };
    },
  });

  process.on("unhandledRejection", onUnhandledRejection);

  try {
    await gateway.start();
    onError?.();

    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(
      unhandledRejections,
      [],
      "snapshot write failures should not escape as unhandled rejections"
    );
    assert.equal((await gateway.status()).lastError, "Gateway websocket error");
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});

test("node gateway service ignores stale close events from an old socket", async () => {
  const openedUrls: string[] = [];
  const closeHandlers: Array<() => void> = [];
  const messageHandlers: Array<(payload: string) => void> = [];
  const timerCallbacks: Array<() => void | Promise<void>> = [];

  const store = {
    async readConfig() {
      return { guilds: {}, botUserId: "bot-user-id" };
    },
    async readGatewaySnapshot() {
      return { status: "idle", sessionId: null, resumeGatewayUrl: null, lastSequence: null, backoffAttempt: 0, lastError: null, heartbeatIntervalMs: null };
    },
    async writeGatewaySnapshot() {},
  } as any;

  const gateway = createNodeGatewayService({
    botToken: "bot-token",
    store,
    openWebSocket(url: string, handlers: any) {
      openedUrls.push(url);
      closeHandlers.push(handlers.onClose);
      messageHandlers.push(handlers.onMessage);
      return {
        send() {},
        close() {},
      };
    },
    setTimer(callback: any, _delayMs: number) {
      timerCallbacks.push(callback);
      return { stop() {} };
    },
  });

  await gateway.start();
  messageHandlers[0]?.(JSON.stringify({ op: 9, d: true }));
  assert.equal(timerCallbacks.length, 1, "invalid session should schedule reconnect");

  await timerCallbacks[0]?.();
  assert.equal(openedUrls.length, 2, "reconnect should open a new websocket");

  closeHandlers[0]?.();
  await gateway.start();

  assert.equal(openedUrls.length, 2, "stale close should not tear down the newer live websocket");
  assert.equal(timerCallbacks.length, 1, "stale close should not schedule an extra backoff");
});
