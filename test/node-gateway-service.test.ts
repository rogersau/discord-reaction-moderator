/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { createNodeGatewayService } from "../src/runtime/node-gateway-service";

test("node gateway service identifies on HELLO and persists READY state", async () => {
  const sent: string[] = [];
  let onMessage: ((payload: string) => void) | undefined;

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

  assert.match(sent[0] ?? "", /"op":2/);
  assert.equal(persisted.sessionId, "session-7");
  assert.equal((await gateway.status()).status, "ready");
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
