/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { startPortableRuntime } from "../src/runtime/node-runtime";

test("startPortableRuntime shuts down opened resources when bootstrap fails", async () => {
  const events: string[] = [];

  await assert.rejects(
    startPortableRuntime({
      config: { port: 8787 },
      app: {
        async bootstrap() {
          events.push("app.bootstrap");
          throw new Error("bootstrap failed");
        },
        fetch() {
          throw new Error("not used");
        },
      },
      store: {
        close() {
          events.push("store.close");
        },
      } as any,
      gateway: {
        async start() {
          return {
            status: "idle",
            sessionId: null,
            resumeGatewayUrl: null,
            lastSequence: null,
            backoffAttempt: 0,
            lastError: null,
            heartbeatIntervalMs: null,
          };
        },
        async status() {
          throw new Error("not used");
        },
        stop() {
          events.push("gateway.stop");
        },
      },
      scheduler: {
        async start() {
          events.push("scheduler.start");
        },
        stop() {
          events.push("scheduler.stop");
        },
      },
      async startServer() {
        events.push("server.start");
        return {
          close(callback?: (error?: Error) => void) {
            events.push("server.close");
            callback?.();
          },
        };
      },
      registerSignalHandler() {},
      logger: {
        log() {},
        error() {},
      },
    }),
    /bootstrap failed/
  );

  assert.deepEqual(events, [
    "server.start",
    "scheduler.start",
    "app.bootstrap",
    "server.close",
    "scheduler.stop",
    "gateway.stop",
    "store.close",
  ]);
});

test("startPortableRuntime waits for the HTTP server to drain before closing the store", async () => {
  const events: string[] = [];
  let finishClose: (() => void) | undefined;

  const runtime = await startPortableRuntime({
    config: { port: 8787 },
    app: {
      async bootstrap() {
        events.push("app.bootstrap");
      },
      fetch() {
        throw new Error("not used");
      },
    },
    store: {
      close() {
        events.push("store.close");
      },
    } as any,
    gateway: {
      async start() {
        return {
          status: "ready",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        };
      },
      async status() {
        throw new Error("not used");
      },
      stop() {
        events.push("gateway.stop");
      },
    },
    scheduler: {
      async start() {
        events.push("scheduler.start");
      },
      stop() {
        events.push("scheduler.stop");
      },
    },
    async startServer() {
      events.push("server.start");
      return {
        close(callback?: (error?: Error) => void) {
          events.push("server.close");
          finishClose = () => callback?.();
        },
      };
    },
    registerSignalHandler() {},
    logger: {
      log() {},
      error() {},
    },
  });

  const shutdown = runtime.shutdown();

  assert.deepEqual(events, [
    "server.start",
    "scheduler.start",
    "app.bootstrap",
    "server.close",
  ]);

  finishClose?.();
  await shutdown;

  assert.deepEqual(events, [
    "server.start",
    "scheduler.start",
    "app.bootstrap",
    "server.close",
    "scheduler.stop",
    "gateway.stop",
    "store.close",
  ]);
});
