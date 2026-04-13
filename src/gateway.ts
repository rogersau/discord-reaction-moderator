export const GATEWAY_OP_DISPATCH = 0;
export const GATEWAY_OP_HEARTBEAT = 1;
export const GATEWAY_OP_IDENTIFY = 2;
export const GATEWAY_OP_RESUME = 6;

const GUILD_INTENT = 1 << 0;
const GUILD_MESSAGE_REACTIONS_INTENT = 1 << 10;
const DEFAULT_GATEWAY_INTENTS = GUILD_INTENT | GUILD_MESSAGE_REACTIONS_INTENT;
const DEFAULT_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

interface GatewayProperties {
  os: string;
  browser: string;
  device: string;
}

interface IdentifyData {
  token: string;
  intents: number;
  properties: GatewayProperties;
}

interface ResumeData {
  token: string;
  session_id: string;
  seq: number;
}

interface GatewayFrame<T> {
  op: number;
  d: T;
}

interface GatewayDispatchEnvelope {
  op: number;
  t: string | null;
  s?: number | null;
  d?: unknown;
}

export function buildIdentifyPayload(token: string): GatewayFrame<IdentifyData> {
  return {
    op: GATEWAY_OP_IDENTIFY,
    d: {
      token,
      intents: DEFAULT_GATEWAY_INTENTS,
      properties: {
        os: "cloudflare",
        browser: "discord-reaction-moderator",
        device: "discord-reaction-moderator",
      },
    },
  };
}

export function buildResumePayload(
  token: string,
  sessionId: string,
  seq: number
): GatewayFrame<ResumeData> {
  return {
    op: GATEWAY_OP_RESUME,
    d: {
      token,
      session_id: sessionId,
      seq,
    },
  };
}

export function buildHeartbeatPayload(
  seq: number | null
): GatewayFrame<number | null> {
  return {
    op: GATEWAY_OP_HEARTBEAT,
    d: seq,
  };
}

export function shouldHandleDispatch(event: GatewayDispatchEnvelope): boolean {
  return event.op === GATEWAY_OP_DISPATCH && event.t === "MESSAGE_REACTION_ADD";
}

export function nextBackoffMillis(attempt: number): number {
  const safeAttempt =
    Number.isFinite(attempt) && attempt >= 0 ? Math.floor(attempt) : 0;
  return Math.min(DEFAULT_BACKOFF_MS * 2 ** safeAttempt, MAX_BACKOFF_MS);
}
