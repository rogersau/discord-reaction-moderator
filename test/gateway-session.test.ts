/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- The worker typecheck config omits Node built-ins and full node:test types conflict with Workers globals; tsconfig.tests provides the runtime test types.
import test from "node:test";

import {
  buildHeartbeatPayload,
  buildIdentifyPayload,
  buildResumePayload,
} from "../src/gateway";
import { GatewaySessionDO } from "../src/durable-objects/gateway-session";

test("GatewaySessionDO reports idle status before startup", async () => {
  const { state } = createGatewayState();
  const gateway = new GatewaySessionDO(
    state,
    { DISCORD_BOT_TOKEN: "bot-token" } as never
  );

  const response = await gateway.fetch(new Request("https://gateway-session/status"));
  const status = (await response.json()) as Record<string, unknown>;

  assert.equal(status.status, "idle");
  assert.equal(status.sessionId, null);
  assert.equal(status.resumeGatewayUrl, null);
  assert.equal(status.lastSequence, null);
  assert.equal(status.backoffAttempt, 0);
  assert.equal(status.lastError, null);
});

test("GatewaySessionDO starts a fresh websocket session from the default gateway URL", async () => {
  const { state } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );

    const response = await gateway.fetch(
      new Request("https://gateway-session/start", { method: "POST" })
    );
    const status = (await response.json()) as Record<string, unknown>;

    assert.equal(response.status, 200);
    assert.equal(sockets.length, 1);
    assert.equal(sockets[0]?.url, "wss://gateway.discord.gg/?v=10&encoding=json");
    assert.equal(status.status, "connecting");
  } finally {
    restore();
  }
});

test("GatewaySessionDO sends identify and schedules heartbeat after HELLO", async () => {
  const clock = mockDateNow(1_000);
  const { state, alarms } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 10,
      t: null,
      s: null,
      d: { heartbeat_interval: 45_000 },
    });

    assert.deepEqual(sockets[0]?.sent, [JSON.stringify(buildIdentifyPayload("bot-token"))]);
    assert.deepEqual(alarms, [46_000]);
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO ignores HELLO frames when the socket is no longer open", async () => {
  const { state, alarms } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    if (sockets[0]) {
      sockets[0].readyState = 2;
    }

    await sockets[0]?.emitMessage({
      op: 10,
      t: null,
      s: null,
      d: { heartbeat_interval: 45_000 },
    });

    assert.deepEqual(sockets[0]?.sent, []);
    assert.deepEqual(alarms, []);
  } finally {
    restore();
  }
});

test("GatewaySessionDO records malformed gateway messages instead of crashing", async () => {
  const { state } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitRawMessage("{");

    const response = await gateway.fetch(new Request("https://gateway-session/status"));
    const status = (await response.json()) as Record<string, unknown>;

    assert.equal(status.lastError, "Failed to parse gateway message");
  } finally {
    restore();
  }
});

test("GatewaySessionDO moderates blocked reaction dispatch events", async () => {
  const { state } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();
  const storeFetches: string[] = [];
  const deleteCalls: Array<{ input: string; method: string | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    deleteCalls.push({
      input: String(input),
      method: init?.method,
    });
    return new Response(null, { status: 204 });
  };

  try {
    const gateway = new GatewaySessionDO(
      state,
      createGatewayEnv({
        moderationStoreFetch(input) {
          storeFetches.push(String(input));
          return Response.json({
            guilds: {
              "guild-1": {
                enabled: true,
                emojis: ["✅"],
              },
            },
            botUserId: "bot-1",
          });
        },
      })
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 0,
      t: "MESSAGE_REACTION_ADD",
      s: 5,
      d: {
        channel_id: "channel-1",
        message_id: "message-1",
        guild_id: "guild-1",
        emoji: { id: null, name: "✅", animated: false },
        user_id: "user-1",
      },
    });

    assert.deepEqual(storeFetches, ["https://moderation-store/config"]);
    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0]?.method, "DELETE");
    assert.match(deleteCalls[0]?.input ?? "", /\/reactions\/%E2%9C%85\/user-1$/);
  } finally {
    globalThis.fetch = originalFetch;
    restore();
  }
});

test("GatewaySessionDO resumes persisted sessions after HELLO", async () => {
  const clock = mockDateNow(5_000);
  const { state, alarms } = createGatewayState({
    session_id: "session-1",
    resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json",
    last_sequence: "42",
  });
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    assert.equal(sockets[0]?.url, "wss://resume.discord.gg/?v=10&encoding=json");

    await sockets[0]?.emitMessage({
      op: 10,
      t: null,
      s: null,
      d: { heartbeat_interval: 30_000 },
    });

    assert.deepEqual(sockets[0]?.sent, [
      JSON.stringify(buildResumePayload("bot-token", "session-1", 42)),
    ]);
    assert.deepEqual(alarms, [35_000]);
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO persists READY metadata and reports ready status", async () => {
  const { state } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 0,
      t: "READY",
      s: 99,
      d: {
        session_id: "session-99",
        resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json",
      },
    });

    const response = await gateway.fetch(new Request("https://gateway-session/status"));
    const status = (await response.json()) as Record<string, unknown>;

    assert.equal(status.status, "ready");
    assert.equal(status.sessionId, "session-99");
    assert.equal(status.resumeGatewayUrl, "wss://resume.discord.gg/?v=10&encoding=json");
    assert.equal(status.lastSequence, 99);
    assert.equal(status.backoffAttempt, 0);
  } finally {
    restore();
  }
});

test("GatewaySessionDO alarm sends a heartbeat with the last known sequence", async () => {
  const clock = mockDateNow(10_000);
  const { state } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 10,
      t: null,
      s: null,
      d: { heartbeat_interval: 45_000 },
    });
    await sockets[0]?.emitMessage({
      op: 0,
      t: "READY",
      s: 12,
      d: {
        session_id: "session-12",
        resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json",
      },
    });

    await gateway.alarm();

    assert.equal(
      sockets[0]?.sent.at(-1),
      JSON.stringify(buildHeartbeatPayload(12))
    );
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO heartbeat send failures update status and reschedule alarms", async () => {
  const clock = mockDateNow(1_000);
  const { state, alarms } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 10,
      t: null,
      s: null,
      d: { heartbeat_interval: 45_000 },
    });
    clock.set(46_000);
    if (sockets[0]) {
      sockets[0].readyState = 2;
    }

    await gateway.alarm();

    const response = await gateway.fetch(new Request("https://gateway-session/status"));
    const status = (await response.json()) as Record<string, unknown>;

    assert.equal(status.lastError, "Failed to send heartbeat");
    assert.deepEqual(alarms, [46_000, 91_000]);
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO clears non-resumable sessions and schedules reconnect on invalid session", async () => {
  const clock = mockDateNow(20_000);
  const { state, alarms } = createGatewayState({
    session_id: "session-1",
    resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json",
    last_sequence: "9",
  });
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitMessage({
      op: 9,
      t: null,
      s: null,
      d: false,
    });

    const response = await gateway.fetch(new Request("https://gateway-session/status"));
    const status = (await response.json()) as Record<string, unknown>;

    assert.equal(status.status, "backoff");
    assert.equal(status.sessionId, null);
    assert.equal(status.resumeGatewayUrl, null);
    assert.equal(status.lastSequence, null);
    assert.equal(status.backoffAttempt, 1);
    assert.deepEqual(alarms, [21_000]);
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO reconnects after invalid sessions close the current socket", async () => {
  const clock = mockDateNow(20_000);
  const { state } = createGatewayState({
    session_id: "session-1",
    resume_gateway_url: "wss://resume.discord.gg/?v=10&encoding=json",
    last_sequence: "9",
  });
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));
    await sockets[0]?.emitMessage({
      op: 9,
      t: null,
      s: null,
      d: false,
    });

    assert.equal(sockets[0]?.readyState, 3);

    clock.set(21_000);
    await gateway.alarm();

    assert.equal(sockets.length, 2);
  } finally {
    restore();
    clock.restore();
  }
});

test("GatewaySessionDO unexpected close events enter backoff and reconnect on alarm", async () => {
  const clock = mockDateNow(30_000);
  const { state, alarms } = createGatewayState();
  const { restore, sockets } = installFakeWebSocket();

  try {
    const gateway = new GatewaySessionDO(
      state,
      { DISCORD_BOT_TOKEN: "bot-token" } as never
    );
    await gateway.fetch(new Request("https://gateway-session/start", { method: "POST" }));

    await sockets[0]?.emitClose();

    const statusResponse = await gateway.fetch(
      new Request("https://gateway-session/status")
    );
    const status = (await statusResponse.json()) as Record<string, unknown>;

    assert.equal(status.status, "backoff");
    assert.equal(status.backoffAttempt, 1);
    assert.deepEqual(alarms, [31_000]);

    clock.set(31_000);
    await gateway.alarm();

    assert.equal(sockets.length, 2);
  } finally {
    restore();
    clock.restore();
  }
});

function createGatewayState(initialValues?: Record<string, string>) {
  const stateMap = new Map<string, string>(Object.entries(initialValues ?? {}));
  const alarms: number[] = [];

  return {
    alarms,
    state: {
      storage: {
        sql: {
          exec(query: string, ...params: unknown[]) {
            if (query.includes("CREATE TABLE IF NOT EXISTS gateway_state")) {
              return [];
            }

            if (
              query ===
              "INSERT INTO gateway_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
            ) {
              stateMap.set(params[0] as string, params[1] as string);
              return [];
            }

            if (query === "DELETE FROM gateway_state WHERE key = ?") {
              stateMap.delete(params[0] as string);
              return [];
            }

            if (query === "SELECT key, value FROM gateway_state") {
              return [...stateMap.entries()].map(([key, value]) => ({ key, value }));
            }

            throw new Error(`Unexpected SQL: ${query}`);
          },
        },
        setAlarm(time: number) {
          alarms.push(time);
          return Promise.resolve();
        },
      },
    } as unknown as DurableObjectState,
  };
}

function createGatewayEnv(options?: {
  moderationStoreFetch?: (input: Request | string | URL) => Response;
}) {
  return {
    DISCORD_BOT_TOKEN: "bot-token",
    BOT_USER_ID: "bot-user-id",
    ADMIN_AUTH_SECRET: undefined,
    GATEWAY_SESSION_DO: {
      idFromName() {
        return "gateway-id" as never;
      },
      get() {
        return {
          fetch: async () => Response.json({ status: "idle" }),
        };
      },
    } as never,
    MODERATION_STORE_DO: {
      idFromName() {
        return "moderation-store-id" as never;
      },
      get() {
        return {
          fetch: async (input: Request | string | URL) =>
            options?.moderationStoreFetch?.(input) ??
            Response.json({ emojis: [], guilds: {}, botUserId: "" }),
        };
      },
    } as never,
  } as never;
}

function installFakeWebSocket() {
  const originalWebSocket = globalThis.WebSocket;
  const sockets: FakeWebSocket[] = [];

  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readonly sent: string[] = [];
    readonly listeners = new Map<string, Array<(event: unknown) => void>>();
    accepted = false;
    readyState = FakeWebSocket.CONNECTING;

    constructor(url: string) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      sockets.push(this);
    }

    accept() {
      this.accepted = true;
      this.readyState = FakeWebSocket.OPEN;
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    send(message: string) {
      if (this.readyState !== FakeWebSocket.OPEN) {
        throw new Error("WebSocket is not open");
      }
      this.sent.push(message);
    }

    close() {
      this.readyState = FakeWebSocket.CLOSED;
    }

    async emitMessage(data: unknown) {
      for (const listener of this.listeners.get("message") ?? []) {
        await listener({ data: JSON.stringify(data) });
      }
    }

    async emitRawMessage(data: string) {
      for (const listener of this.listeners.get("message") ?? []) {
        await listener({ data });
      }
    }

    async emitClose() {
      this.readyState = FakeWebSocket.CLOSED;
      for (const listener of this.listeners.get("close") ?? []) {
        await listener({});
      }
    }
  }

  globalThis.WebSocket = FakeWebSocket as never;

  return {
    sockets,
    restore() {
      globalThis.WebSocket = originalWebSocket;
    },
  };
}

function mockDateNow(now: number) {
  const originalNow = Date.now;
  let current = now;
  Date.now = () => current;

  return {
    set(nextNow: number) {
      current = nextNow;
    },
    restore() {
      Date.now = originalNow;
    },
  };
}
