import type {
  BlocklistConfig,
  NewMemberTimedRoleConfig,
  TicketInstance,
  TicketPanelConfig,
  TimedRoleAssignment,
} from "../types";
import type { AppConfigMutation } from "./admin-types";

export type { BlocklistStore } from "./contracts/blocklist-store";
export type { AppConfigStore } from "./contracts/app-config-store";
export type { TimedRoleStore } from "./contracts/timed-role-store";
export type { TicketStore } from "./contracts/ticket-store";

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
  applyGuildEmojiMutation(body: {
    guildId: string;
    emoji: string;
    action: "add" | "remove";
  }): Promise<BlocklistConfig>;
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
  readNewMemberTimedRoleConfig(guildId: string): Promise<NewMemberTimedRoleConfig>;
  upsertNewMemberTimedRoleConfig(body: NewMemberTimedRoleConfig): Promise<void>;
  readGatewaySnapshot(): Promise<GatewaySnapshot>;
  writeGatewaySnapshot(snapshot: GatewaySnapshot): Promise<void>;
}

export interface TicketTranscriptBlobStore {
  putHtml(key: string, html: string): Promise<void>;
  getHtml(key: string): Promise<string | null>;
  putAttachment(
    key: string,
    body: ReadableStream<Uint8Array> | ArrayBuffer | string,
    options: { contentType: string | null },
  ): Promise<void>;
  getAttachment(key: string): Promise<{
    body: ReadableStream<Uint8Array> | ArrayBuffer | string;
    contentType: string | null;
  } | null>;
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
