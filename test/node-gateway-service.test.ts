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
  });

  await gateway.start();
  onMessage?.(JSON.stringify({ op: 10, d: { heartbeat_interval: 45000 } }));
  onMessage?.(JSON.stringify({ op: 0, t: "READY", s: 7, d: { session_id: "session-7", resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json" } }));

  assert.match(sent[0] ?? "", /"op":2/);
  assert.equal(persisted.sessionId, "session-7");
  assert.equal((await gateway.status()).status, "ready");
});
