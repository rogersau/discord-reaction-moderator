import type {
  BlocklistConfig,
  TicketInstance,
  TicketPanelConfig,
  TimedRoleAssignment,
} from "../types";
import type { AppConfigMutation } from "./admin-types";

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
  upsertAppConfig(body: AppConfigMutation): Promise<void>;
  applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig>;
  reserveNextTicketNumber(guildId: string): Promise<number>;
  readTicketPanelConfig(guildId: string): Promise<TicketPanelConfig | null>;
  upsertTicketPanelConfig(panel: TicketPanelConfig): Promise<void>;
  createTicketInstance(instance: TicketInstance): Promise<void>;
  deleteTicketInstance(body: { guildId: string; channelId: string }): Promise<void>;
  readOpenTicketByChannel(guildId: string, channelId: string): Promise<TicketInstance | null>;
  closeTicketInstance(body: {
    guildId: string;
    channelId: string;
    closedByUserId: string;
    closedAtMs: number;
    transcriptMessageId: string | null;
  }): Promise<void>;
  listTimedRoles(): Promise<TimedRoleAssignment[]>;
  listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]>;
  upsertTimedRole(body: TimedRoleAssignment): Promise<void>;
  deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void>;
  listExpiredTimedRoles(nowMs: number): Promise<TimedRoleAssignment[]>;
  readGatewaySnapshot(): Promise<GatewaySnapshot>;
  writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void>;
}

export interface TicketTranscriptBlobStore {
  putHtml(key: string, html: string): Promise<void>;
  getHtml(key: string): Promise<string | null>;
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
