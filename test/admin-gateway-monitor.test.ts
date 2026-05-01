/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import {
  startGatewayStatusMonitor,
  type GatewayStatusMonitorOptions,
} from "../src/admin-gateway-monitor";

test("gateway status monitor refreshes immediately and on each timer tick", async () => {
  const statuses = ["backoff", "ready"];
  const observed: string[] = [];
  const errors: unknown[] = [];
  const intervalCallbacks: Array<() => void> = [];
  const intervalToken = { id: "interval-token" };

  const monitor = startGatewayStatusMonitor({
    intervalMs: 5000,
    loadStatus: async () => ({ status: statuses.shift() ?? "ready" }),
    onStatus(status: { status: string }) {
      observed.push(status.status);
    },
    onError(error: unknown) {
      errors.push(error);
    },
    setInterval(
      callback: GatewayStatusMonitorOptions<{ status: string }>["setInterval"] extends (
        cb: infer Callback,
        delayMs: number,
      ) => unknown
        ? Callback
        : never,
      delayMs: number,
    ) {
      assert.equal(delayMs, 5000);
      intervalCallbacks.push(callback);
      return intervalToken;
    },
    clearInterval(token: unknown) {
      assert.deepEqual(token, intervalToken);
    },
  });

  await Promise.resolve();
  assert.deepEqual(observed, ["backoff"]);

  intervalCallbacks[0]?.();
  await Promise.resolve();
  assert.deepEqual(observed, ["backoff", "ready"]);
  assert.deepEqual(errors, []);

  monitor.stop();
});

test("gateway status monitor supports on-demand refreshes", async () => {
  const statuses = ["backoff", "ready"];
  const observed: string[] = [];

  const monitor = startGatewayStatusMonitor({
    intervalMs: 5000,
    loadStatus: async () => ({ status: statuses.shift() ?? "ready" }),
    onStatus(status: { status: string }) {
      observed.push(status.status);
    },
    onError() {
      throw new Error("did not expect polling errors");
    },
    setInterval() {
      return { id: "interval-token" };
    },
    clearInterval() {},
  });

  await Promise.resolve();
  assert.deepEqual(observed, ["backoff"]);

  await monitor.refresh();
  assert.deepEqual(observed, ["backoff", "ready"]);

  monitor.stop();
});
