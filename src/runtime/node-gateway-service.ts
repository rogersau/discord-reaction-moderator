import {
  buildHeartbeatPayload,
  buildIdentifyPayload,
  buildResumePayload,
  nextBackoffMillis,
  shouldHandleDispatch,
} from "../gateway";
import { isEmojiBlocked, normalizeEmoji } from "../blocklist";
import { deleteReaction } from "../discord";
import type { GatewayController, GatewaySnapshot, RuntimeStore } from "./contracts";
import type { DiscordReaction } from "../types";

const DEFAULT_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

interface GatewayEnvelope {
  op: number;
  t?: string | null;
  s?: number | null;
  d?: unknown;
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
}

interface WebSocketHandlers {
  onMessage: (payload: string) => void;
  onClose: () => void;
  onError: () => void;
}

interface TimerLike {
  stop(): void;
}

interface NodeGatewayServiceOptions {
  botToken: string;
  store: RuntimeStore;
  openWebSocket: (url: string, handlers: WebSocketHandlers) => WebSocketLike;
  setTimer: (callback: () => void | Promise<void>, delayMs: number) => TimerLike;
}

export function createNodeGatewayService(options: NodeGatewayServiceOptions): GatewayController {
  let snapshot: GatewaySnapshot;
  let socket: WebSocketLike | null = null;
  let heartbeatTimer: any = null;
  let backoffTimer: TimerLike | null = null;
  let startPromise: Promise<GatewaySnapshot> | null = null;

  return {
    start,
    status,
  };

  async function start(): Promise<GatewaySnapshot> {
    if (startPromise) {
      return startPromise;
    }

    startPromise = (async () => {
      if (!snapshot) {
        snapshot = await options.store.readGatewaySnapshot();
      }

      if (socket !== null) {
        return snapshot;
      }

      const shouldResume =
        snapshot.sessionId !== null &&
        snapshot.resumeGatewayUrl !== null &&
        snapshot.lastSequence !== null;

      snapshot.status = shouldResume ? "resuming" : "connecting";
      await options.store.writeGatewaySnapshot(snapshot);

      socket = options.openWebSocket(
        snapshot.resumeGatewayUrl ?? DEFAULT_GATEWAY_URL,
        {
          onMessage: (payload: string) => {
            void handleSocketMessage(payload);
          },
          onClose: () => {
            stopHeartbeat();
            if (socket) {
              socket = null;
            }
            if (snapshot.status !== "idle" && snapshot.status !== "backoff") {
              enterBackoff();
            }
          },
          onError: () => {
            snapshot.lastError = "Gateway websocket error";
            void options.store.writeGatewaySnapshot(snapshot);
          },
        }
      );

      return snapshot;
    })();

    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function status(): Promise<GatewaySnapshot> {
    if (!snapshot) {
      snapshot = await options.store.readGatewaySnapshot();
    }
    return snapshot;
  }

  async function handleSocketMessage(data: string): Promise<void> {
    try {
      const payload = JSON.parse(data) as GatewayEnvelope;

      if (typeof payload.s === "number") {
        snapshot.lastSequence = payload.s;
        void options.store.writeGatewaySnapshot(snapshot);
      }

      if (payload.op === 10) {
        void handleHello(payload.d);
        return;
      }

      if (payload.op === 9) {
        handleInvalidSession(payload.d === true);
        return;
      }

      if (payload.op !== 0) {
        return;
      }

      if (shouldHandleDispatch({ op: payload.op, t: payload.t ?? null, s: payload.s })) {
        const reaction = payload.d as DiscordReaction | null;
        if (reaction) {
          void moderateReaction(reaction);
        }
        return;
      }

      if (payload.t === "READY" && isReadyPayload(payload.d)) {
        snapshot.sessionId = payload.d.session_id;
        snapshot.resumeGatewayUrl = payload.d.resume_gateway_url;
        snapshot.status = "ready";
        snapshot.backoffAttempt = 0;
        snapshot.lastError = null;
        void options.store.writeGatewaySnapshot(snapshot);
        return;
      }

      if (payload.t === "RESUMED") {
        snapshot.status = "ready";
        snapshot.backoffAttempt = 0;
        snapshot.lastError = null;
        void options.store.writeGatewaySnapshot(snapshot);
      }
    } catch {
      snapshot.lastError = "Failed to parse gateway message";
      void options.store.writeGatewaySnapshot(snapshot);
    }
  }

  function handleHello(data: unknown): void {
    const heartbeatIntervalMs = getHeartbeatInterval(data);
    if (heartbeatIntervalMs === null || !socket) {
      return;
    }

    snapshot.heartbeatIntervalMs = heartbeatIntervalMs;

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    heartbeatTimer = setInterval(() => {
      if (socket) {
        try {
          socket.send(JSON.stringify(buildHeartbeatPayload(snapshot.lastSequence)));
          snapshot.lastError = null;
        } catch {
          snapshot.lastError = "Failed to send heartbeat";
          void options.store.writeGatewaySnapshot(snapshot);
        }
      }
    }, heartbeatIntervalMs);

    const canResume =
      snapshot.sessionId !== null &&
      snapshot.resumeGatewayUrl !== null &&
      snapshot.lastSequence !== null;

    if (canResume) {
      socket.send(
        JSON.stringify(
          buildResumePayload(
            options.botToken,
            snapshot.sessionId as string,
            snapshot.lastSequence as number
          )
        )
      );
      snapshot.status = "resuming";
    } else {
      socket.send(JSON.stringify(buildIdentifyPayload(options.botToken, "node")));
      snapshot.status = "connecting";
    }

    void options.store.writeGatewaySnapshot(snapshot);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function handleInvalidSession(canResume: boolean): void {
    const currentSocket = socket;
    socket = null;

    if (!canResume) {
      snapshot.sessionId = null;
      snapshot.resumeGatewayUrl = null;
      snapshot.lastSequence = null;
    }

    enterBackoff();

    if (currentSocket) {
      currentSocket.close();
    }
  }

  function enterBackoff(): void {
    stopHeartbeat();
    const backoffMs = nextBackoffMillis(snapshot.backoffAttempt);
    snapshot.status = "backoff";
    snapshot.backoffAttempt += 1;
    snapshot.lastError = `Reconnecting in ${backoffMs}ms`;
    void options.store.writeGatewaySnapshot(snapshot);

    if (backoffTimer) {
      backoffTimer.stop();
    }
    backoffTimer = options.setTimer(async () => {
      await start();
    }, backoffMs);
  }

  async function moderateReaction(reaction: DiscordReaction): Promise<void> {
    let config;
    try {
      config = await options.store.readConfig();
    } catch {
      snapshot.lastError = "Failed to load moderation config";
      void options.store.writeGatewaySnapshot(snapshot);
      return;
    }

    const emojiName = normalizeEmoji(reaction.emoji.name);
    let emojiId: string;

    if (reaction.emoji.id && reaction.emoji.name) {
      emojiId = `${reaction.emoji.name}:${reaction.emoji.id}`;
    } else if (emojiName) {
      emojiId = emojiName;
    } else {
      return;
    }

    if (reaction.user_id === config.botUserId) {
      return;
    }

    if (!isEmojiBlocked(emojiId, config, reaction.guild_id)) {
      return;
    }

    try {
      await deleteReaction(
        reaction.channel_id,
        reaction.message_id,
        reaction.emoji,
        reaction.user_id,
        options.botToken
      );

      console.log(
        `Removed reaction ${emojiId} from message ${reaction.message_id} in channel ${reaction.channel_id}`
      );
    } catch (error) {
      console.error("Failed to remove reaction:", error);
    }
  }
}

function getHeartbeatInterval(data: unknown): number | null {
  if (
    typeof data === "object" &&
    data !== null &&
    "heartbeat_interval" in data &&
    typeof data.heartbeat_interval === "number"
  ) {
    return data.heartbeat_interval;
  }
  return null;
}

function isReadyPayload(
  data: unknown
): data is { session_id: string; resume_gateway_url: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "session_id" in data &&
    typeof data.session_id === "string" &&
    "resume_gateway_url" in data &&
    typeof data.resume_gateway_url === "string"
  );
}
