import type { BlocklistConfig, TimedRoleAssignment } from "../types";

export interface GatewaySnapshot {
  status: "idle" | "connecting" | "ready" | "resuming" | "backoff";
  sessionId: string | null;
  resumeGatewayUrl: string | null;
  lastSequence: number | null;
  backoffAttempt: number;
  lastError: string | null;
  heartbeatIntervalMs: number | null;
}

export interface RuntimeStore {
  readConfig(): Promise<BlocklistConfig>;
  applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig>;
  listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]>;
  upsertTimedRole(body: TimedRoleAssignment): Promise<void>;
  deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void>;
  listExpiredTimedRoles(nowMs: number): Promise<TimedRoleAssignment[]>;
  readGatewaySnapshot(): Promise<GatewaySnapshot>;
  writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void>;
}

export interface GatewayController {
  start(): Promise<GatewaySnapshot>;
  status(): Promise<GatewaySnapshot>;
}

export interface ManagedGatewayController extends GatewayController {
  stop(): void;
}

export interface ClosableRuntimeStore extends RuntimeStore {
  close(): void;
}
