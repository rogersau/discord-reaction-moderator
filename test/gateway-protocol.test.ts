/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  buildHeartbeatPayload,
  buildIdentifyPayload,
  buildResumePayload,
  nextBackoffMillis,
  shouldHandleDispatch,
} from "../src/gateway";

test("buildIdentifyPayload creates the expected gateway identify frame", () => {
  assert.deepEqual(buildIdentifyPayload("bot-token"), {
    op: 2,
    d: {
      token: "bot-token",
      intents: 1025,
      properties: {
        os: "cloudflare",
        browser: "discord-automation-workers",
        device: "discord-automation-workers",
      },
    },
  });
});

test("buildResumePayload creates the expected gateway resume frame", () => {
  assert.deepEqual(buildResumePayload("bot-token", "session-1", 42), {
    op: 6,
    d: {
      token: "bot-token",
      session_id: "session-1",
      seq: 42,
    },
  });
});

test("buildHeartbeatPayload includes the last known sequence", () => {
  assert.deepEqual(buildHeartbeatPayload(42), {
    op: 1,
    d: 42,
  });
});

test("buildHeartbeatPayload uses null when no sequence is known", () => {
  assert.deepEqual(buildHeartbeatPayload(null), {
    op: 1,
    d: null,
  });
});

test("shouldHandleDispatch returns true for message reaction add events", () => {
  assert.equal(
    shouldHandleDispatch({
      op: 0,
      t: "MESSAGE_REACTION_ADD",
      s: 101,
      d: { message_id: "message-1" },
    }),
    true
  );
});

test("shouldHandleDispatch ignores non-dispatch and unrelated events", () => {
  assert.equal(
    shouldHandleDispatch({
      op: 10,
      t: "HELLO",
      s: null,
      d: { heartbeat_interval: 45000 },
    }),
    false
  );
  assert.equal(
    shouldHandleDispatch({
      op: 0,
      t: "READY",
      s: 1,
      d: { session_id: "session-1" },
    }),
    false
  );
});

test("nextBackoffMillis grows exponentially from the base delay", () => {
  assert.equal(nextBackoffMillis(0), 1000);
  assert.equal(nextBackoffMillis(1), 2000);
  assert.equal(nextBackoffMillis(2), 4000);
});

test("nextBackoffMillis caps at the max delay", () => {
  assert.equal(nextBackoffMillis(10), 30000);
});

test("nextBackoffMillis falls back to the base delay for non-finite attempts", () => {
  assert.equal(nextBackoffMillis(Number.NaN), 1000);
});

test("nextBackoffMillis floors fractional attempt counts", () => {
  assert.equal(nextBackoffMillis(1.5), 2000);
});
