import type { BlocklistConfig, TimedRoleAssignment, TicketPanelConfig, TicketInstance } from "../types";
import type { GatewaySnapshot } from "./contracts";

export function createCloudflareStoreClient(storeStub: { fetch: (...args: any[]) => Promise<any> }) {
  return {
    async readConfig(): Promise<BlocklistConfig> {
      return readJson(storeStub.fetch("https://moderation-store/config"));
    },
    async applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig> {
      return readJson(
        storeStub.fetch("https://moderation-store/guild-emoji", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async upsertAppConfig(body: { key: string; value: string }): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/app-config", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async readTicketPanelConfig(guildId: string): Promise<TicketPanelConfig | null> {
      return readJson(
        storeStub.fetch(`https://moderation-store/ticket-panel?guildId=${encodeURIComponent(guildId)}`)
      );
    },
    async upsertTicketPanelConfig(panel: TicketPanelConfig): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/ticket-panel", {
          method: "POST",
          body: JSON.stringify(panel),
        })
      );
    },
    async createTicketInstance(instance: TicketInstance): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/ticket-instance", {
          method: "POST",
          body: JSON.stringify(instance),
        })
      );
    },
    async deleteTicketInstance(body: { guildId: string; channelId: string }): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/ticket-instance/delete", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async readOpenTicketByChannel(guildId: string, channelId: string): Promise<TicketInstance | null> {
      return readJson(
        storeStub.fetch(
          `https://moderation-store/ticket-instance/open?guildId=${encodeURIComponent(guildId)}&channelId=${encodeURIComponent(channelId)}`
        )
      );
    },
    async closeTicketInstance(body: {
      guildId: string;
      channelId: string;
      closedByUserId: string;
      closedAtMs: number;
      transcriptMessageId: string | null;
    }): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/ticket-instance/close", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async listTimedRoles(): Promise<TimedRoleAssignment[]> {
      return readJson(storeStub.fetch("https://moderation-store/timed-roles"));
    },
    async listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]> {
      return readJson(
        storeStub.fetch(`https://moderation-store/timed-roles?guildId=${encodeURIComponent(guildId)}`)
      );
    },
    async upsertTimedRole(body: {
      guildId: string;
      userId: string;
      roleId: string;
      durationInput: string;
      expiresAtMs: number;
    }): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/timed-role", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async deleteTimedRole(body: { guildId: string; userId: string; roleId: string }): Promise<void> {
      await readJsonVoid(
        storeStub.fetch("https://moderation-store/timed-role/remove", {
          method: "POST",
          body: JSON.stringify(body),
        })
      );
    },
    async readGatewaySnapshot(): Promise<GatewaySnapshot> {
      return readJson(storeStub.fetch("https://gateway-session/status"));
    },
    async writeGatewaySnapshot(_snapshot: GatewaySnapshot): Promise<void> {
      // Cloudflare: Gateway session state persists in Durable Object storage
      // No-op - Durable Objects maintain state automatically
    },
  };
}

async function readJson(responsePromise: Promise<unknown>): Promise<any> {
  const response = await responsePromise as Response;
  if (!response.ok) {
    throw new Error(`Cloudflare store request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function readJsonVoid(responsePromise: Promise<unknown>): Promise<void> {
  const response = await responsePromise as Response;
  if (!response.ok) {
    throw new Error(`Cloudflare store request failed: ${response.status} ${await response.text()}`);
  }
}
