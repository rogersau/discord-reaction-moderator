import type { BlocklistStore, TicketStore } from "../runtime/contracts";
import type { TicketPanelConfig, TicketTypeConfig, TicketInstance, TicketAnswer } from "../types";

export interface CreateTicketChannelConfig {
  guildId: string;
  name: string;
  parentId: string;
  botUserId: string;
  openerUserId: string;
  supportRoleId: string;
}

export interface TicketServiceOptions {
  guildId: string;
  openerUserId: string;
  panel: TicketPanelConfig;
  ticketType: TicketTypeConfig;
  answers: TicketAnswer[];
}

export class TicketService {
  constructor(
    private readonly blocklistStore: BlocklistStore,
    private readonly ticketStore: TicketStore,
    _botToken: string,
    private readonly createChannel?: (config: CreateTicketChannelConfig) => Promise<{ id: string }>,
    private readonly deleteChannel?: (channelId: string) => Promise<void>,
  ) {}

  async openTicket(options: TicketServiceOptions): Promise<TicketInstance> {
    if (!this.createChannel) {
      throw new Error("createChannel handler not configured");
    }

    const { openTicket } = await import("./tickets/open-ticket");
    return openTicket(
      {
        readConfig: () => this.blocklistStore.readConfig(),
        reserveNextTicketNumber: (guildId: string) =>
          this.ticketStore.reserveNextTicketNumber(guildId),
        createTicketInstance: (instance: TicketInstance) =>
          this.ticketStore.createTicketInstance(instance),
        deleteTicketInstance: (body: { guildId: string; channelId: string }) =>
          this.ticketStore.deleteTicketInstance(body),
      },
      {
        createChannel: this.createChannel,
        deleteChannel: this.deleteChannel ?? (async () => {}),
        createOpeningMessage: async () => {},
      },
      options,
    );
  }

  async closeTicket(options: { guildId: string; channelId: string }): Promise<void> {
    if (this.deleteChannel) {
      await this.deleteChannel(options.channelId);
    }

    await this.ticketStore.closeTicketInstance({
      guildId: options.guildId,
      channelId: options.channelId,
      closedByUserId: "system",
      closedAtMs: Date.now(),
      transcriptMessageId: null,
    });
  }
}
