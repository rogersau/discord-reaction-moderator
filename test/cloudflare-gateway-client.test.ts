/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Test compiled via tsconfig.tests.json.
import test from "node:test";

import { createCloudflareGatewayClient } from "../src/runtime/cloudflare-gateway-client";

test("createCloudflareGatewayClient wraps gateway status and bootstrap calls", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const gatewayClient = createCloudflareGatewayClient({
    fetch(input, init) {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Promise.resolve(
        Response.json({
          status: "idle",
          sessionId: null,
          resumeGatewayUrl: null,
          lastSequence: null,
          backoffAttempt: 0,
          lastError: null,
          heartbeatIntervalMs: null,
        }) as any,
      );
    },
  });

  await gatewayClient.status();
  await gatewayClient.start();

  assert.deepEqual(requests, [
    { url: "https://gateway-session/status", method: "GET" },
    { url: "https://gateway-session/start", method: "POST" },
  ]);
});

test("createCloudflareGatewayClient throws descriptive error on non-ok response", async () => {
  const gatewayClient = createCloudflareGatewayClient({
    fetch() {
      return Promise.resolve(new Response("Service Unavailable", { status: 503 }) as any);
    },
  });

  await assert.rejects(
    async () => {
      await gatewayClient.status();
    },
    {
      name: "Error",
      message: /Cloudflare gateway request failed: 503 Service Unavailable/,
    },
  );
});
