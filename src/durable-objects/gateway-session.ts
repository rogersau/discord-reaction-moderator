import type { Env } from "../env";
import {
  buildHeartbeatPayload,
  buildIdentifyPayload,
  buildResumePayload,
  nextBackoffMillis,
  shouldHandleDispatch,
} from "../gateway";
import { moderateReactionAdd } from "../reaction-moderation";
import type { DiscordReaction } from "../types";

const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

type GatewayStatus = "idle" | "connecting" | "ready" | "resuming" | "backoff";

interface GatewaySessionSnapshot {
  status: GatewayStatus;
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

interface GatewayEnvelope {
  op: number;
  t?: string | null;
  s?: number | null;
  d?: unknown;
}

export class GatewaySessionDO implements DurableObject {
  private readonly sql: DurableObjectStorage["sql"];
  private readonly env: Env;
  private readonly ctx: DurableObjectState;
  private socket: WebSocket | null = null;
  private snapshot: GatewaySessionSnapshot;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS gateway_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.snapshot = this.loadSnapshot();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json(this.publicSnapshot());
    }

    if (request.method === "POST" && url.pathname === "/start") {
      await this.start();
      return Response.json(this.publicSnapshot());
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    if (this.snapshot.status === "backoff") {
      await this.start();
      return;
    }

    if (!this.socket || this.snapshot.heartbeatIntervalMs === null) {
      return;
    }

    try {
      this.socket.send(
        JSON.stringify(buildHeartbeatPayload(this.snapshot.lastSequence))
      );
      this.snapshot.lastError = null;
      this.deleteValue("last_error");
    } catch {
      this.snapshot.lastError = "Failed to send heartbeat";
      this.persistValue("last_error", this.snapshot.lastError);
    }
    await this.scheduleAlarm(this.snapshot.heartbeatIntervalMs);
  }

  private async start(): Promise<void> {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      return;
    }

    const shouldResume = this.canResume();
    this.snapshot.status = shouldResume ? "resuming" : "connecting";
    this.persistValue("status", this.snapshot.status);

    const socket = new WebSocket(
      this.snapshot.resumeGatewayUrl ?? DEFAULT_GATEWAY_URL
    );
    socket.addEventListener("message", async (event) => {
      await this.handleSocketMessage(event);
    });
    socket.addEventListener("close", () => {
      if (this.socket === socket) {
        this.socket = null;
      }

      if (this.snapshot.status === "idle" || this.snapshot.status === "backoff") {
        return;
      }

      void this.enterBackoff();
    });
    socket.addEventListener("error", () => {
      this.snapshot.lastError = "Gateway websocket error";
      this.persistValue("last_error", this.snapshot.lastError);
    });
    this.socket = socket;
  }

  private async handleSocketMessage(event: { data: unknown }): Promise<void> {
    try {
      if (typeof event.data !== "string") {
        return;
      }

      const payload = JSON.parse(event.data) as GatewayEnvelope;

      if (typeof payload.s === "number") {
        this.snapshot.lastSequence = payload.s;
        this.persistValue("last_sequence", String(payload.s));
      }

      if (payload.op === 10) {
        await this.handleHello(payload.d);
        return;
      }

      if (payload.op === 9) {
        await this.handleInvalidSession(payload.d === true);
        return;
      }

      if (payload.op !== 0) {
        return;
      }

      if (shouldHandleDispatch({ op: payload.op, t: payload.t ?? null })) {
        await moderateReactionAdd(payload.d as DiscordReaction | null, this.env);
        return;
      }

      if (payload.t === "READY" && isReadyPayload(payload.d)) {
        this.snapshot.sessionId = payload.d.session_id;
        this.snapshot.resumeGatewayUrl = payload.d.resume_gateway_url;
        this.snapshot.status = "ready";
        this.snapshot.backoffAttempt = 0;
        this.snapshot.lastError = null;
        this.persistValue("session_id", payload.d.session_id);
        this.persistValue("resume_gateway_url", payload.d.resume_gateway_url);
        this.persistValue("status", "ready");
        this.persistValue("backoff_attempt", "0");
        this.deleteValue("last_error");
        return;
      }

      if (payload.t === "RESUMED") {
        this.snapshot.status = "ready";
        this.snapshot.backoffAttempt = 0;
        this.snapshot.lastError = null;
        this.persistValue("status", "ready");
        this.persistValue("backoff_attempt", "0");
        this.deleteValue("last_error");
      }
    } catch {
      this.snapshot.lastError = "Failed to parse gateway message";
      this.persistValue("last_error", this.snapshot.lastError);
    }
  }

  private async handleHello(data: unknown): Promise<void> {
    const heartbeatIntervalMs = getHeartbeatInterval(data);
    if (
      heartbeatIntervalMs === null ||
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    this.snapshot.heartbeatIntervalMs = heartbeatIntervalMs;
    this.persistValue("heartbeat_interval_ms", String(heartbeatIntervalMs));
    await this.scheduleAlarm(heartbeatIntervalMs);

    if (this.canResume()) {
      this.socket.send(
        JSON.stringify(
          buildResumePayload(
            this.env.DISCORD_BOT_TOKEN,
            this.snapshot.sessionId as string,
            this.snapshot.lastSequence as number
          )
        )
      );
      this.snapshot.status = "resuming";
      this.persistValue("status", "resuming");
      return;
    }

    this.socket.send(JSON.stringify(buildIdentifyPayload(this.env.DISCORD_BOT_TOKEN)));
    this.snapshot.status = "connecting";
    this.persistValue("status", "connecting");
  }

  private async handleInvalidSession(canResume: boolean): Promise<void> {
    const currentSocket = this.socket;
    this.socket = null;

    if (!canResume) {
      this.snapshot.sessionId = null;
      this.snapshot.resumeGatewayUrl = null;
      this.snapshot.lastSequence = null;
      this.deleteValue("session_id");
      this.deleteValue("resume_gateway_url");
      this.deleteValue("last_sequence");
    }

    await this.enterBackoff();

    if (currentSocket) {
      currentSocket.close();
    }
  }

  private canResume(): boolean {
    return (
      this.snapshot.sessionId !== null &&
      this.snapshot.resumeGatewayUrl !== null &&
      this.snapshot.lastSequence !== null
    );
  }

  private async scheduleAlarm(delayMs: number): Promise<void> {
    await this.ctx.storage.setAlarm(Date.now() + delayMs);
  }

  private async enterBackoff(): Promise<void> {
    const delayMs = nextBackoffMillis(this.snapshot.backoffAttempt);
    this.snapshot.backoffAttempt += 1;
    this.snapshot.status = "backoff";
    this.persistValue("backoff_attempt", String(this.snapshot.backoffAttempt));
    this.persistValue("status", "backoff");
    await this.scheduleAlarm(delayMs);
  }

  private publicSnapshot() {
    return {
      status: this.snapshot.status,
      sessionId: this.snapshot.sessionId,
      resumeGatewayUrl: this.snapshot.resumeGatewayUrl,
      lastSequence: this.snapshot.lastSequence,
      backoffAttempt: this.snapshot.backoffAttempt,
      lastError: this.snapshot.lastError,
    };
  }

  private loadSnapshot(): GatewaySessionSnapshot {
    const rows = [...this.sql.exec("SELECT key, value FROM gateway_state")].map((row) => ({
      key: row.key as string,
      value: row.value as string,
    }));
    const values = new Map(rows.map((row) => [row.key, row.value]));

    return {
      status: parseGatewayStatus(values.get("status")),
      sessionId: values.get("session_id") ?? null,
      resumeGatewayUrl: values.get("resume_gateway_url") ?? null,
      lastSequence: parseOptionalNumber(values.get("last_sequence")),
      backoffAttempt: parseOptionalNumber(values.get("backoff_attempt")) ?? 0,
      lastError: values.get("last_error") ?? null,
      heartbeatIntervalMs: parseOptionalNumber(values.get("heartbeat_interval_ms")),
    };
  }

  private persistValue(key: string, value: string): void {
    this.sql.exec(
      "INSERT INTO gateway_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value
    );
  }

  private deleteValue(key: string): void {
    this.sql.exec("DELETE FROM gateway_state WHERE key = ?", key);
  }
}

function parseGatewayStatus(value: string | undefined): GatewayStatus {
  if (
    value === "connecting" ||
    value === "ready" ||
    value === "resuming" ||
    value === "backoff"
  ) {
    return value;
  }

  return "idle";
}

function parseOptionalNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getHeartbeatInterval(data: unknown): number | null {
  if (!isRecord(data) || typeof data.heartbeat_interval !== "number") {
    return null;
  }

  return data.heartbeat_interval;
}

function isReadyPayload(
  data: unknown
): data is { session_id: string; resume_gateway_url: string } {
  return (
    isRecord(data) &&
    typeof data.session_id === "string" &&
    typeof data.resume_gateway_url === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
