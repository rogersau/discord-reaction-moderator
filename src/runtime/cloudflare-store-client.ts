import type { BlocklistConfig, TimedRoleAssignment, TicketPanelConfig, TicketInstance } from "../types";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createCloudflareStoreClient(storeStub: { fetch: FetchLike }) {
  return {
    async readConfig(): Promise<BlocklistConfig> {
      return readJson<BlocklistConfig>(storeStub.fetch("https://moderation-store/config"));
    },
    async applyGuildEmojiMutation(body: { guildId: string; emoji: string; action: "add" | "remove" }): Promise<BlocklistConfig> {
      return readJson<BlocklistConfig>(
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
      return readJson<TicketPanelConfig | null>(
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
      return readJson<TicketInstance | null>(
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
      return readJson<TimedRoleAssignment[]>(storeStub.fetch("https://moderation-store/timed-roles"));
    },
    async listTimedRolesByGuild(guildId: string): Promise<TimedRoleAssignment[]> {
      return readJson<TimedRoleAssignment[]>(
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
  };
}

async function validateResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.ok) {
    throw new Error(`Cloudflare store request failed: ${response.status} ${await response.text()}`);
  }
  return response;
}

async function readJson<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await validateResponse(responsePromise);
  return response.json();
}

async function readJsonVoid(responsePromise: Promise<Response>): Promise<void> {
  await validateResponse(responsePromise);
}
