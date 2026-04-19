import type { RuntimeStore } from "../runtime/contracts";
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
    private readonly store: RuntimeStore,
    _botToken: string,
    private readonly createChannel?: (config: CreateTicketChannelConfig) => Promise<{ id: string }>,
    private readonly deleteChannel?: (channelId: string) => Promise<void>
  ) {}

  async openTicket(options: TicketServiceOptions): Promise<TicketInstance> {
    const config = await this.store.readConfig();

    // Create Discord channel
    if (!this.createChannel) {
      throw new Error("createChannel handler not configured");
    }

    const channelName = `${options.ticketType.channelNamePrefix}-${options.openerUserId}`;
    const channel = await this.createChannel({
      guildId: options.guildId,
      name: channelName,
      parentId: options.panel.categoryChannelId,
      botUserId: config.botUserId,
      openerUserId: options.openerUserId,
      supportRoleId: options.ticketType.supportRoleId,
    });

    // Persist ticket instance
    const instance: TicketInstance = {
      guildId: options.guildId,
      channelId: channel.id,
      ticketTypeId: options.ticketType.id,
      ticketTypeLabel: options.ticketType.label,
      openerUserId: options.openerUserId,
      supportRoleId: options.ticketType.supportRoleId,
      status: "open",
      answers: options.answers,
      openedAtMs: Date.now(),
      closedAtMs: null,
      closedByUserId: null,
      transcriptMessageId: null,
    };

    await this.store.createTicketInstance(instance);

    return instance;
  }

  async closeTicket(options: { guildId: string; channelId: string }): Promise<void> {
    // Delete Discord channel
    if (this.deleteChannel) {
      await this.deleteChannel(options.channelId);
    }

    // Close ticket in database
    await this.store.closeTicketInstance({
      guildId: options.guildId,
      channelId: options.channelId,
      closedByUserId: "system",
      closedAtMs: Date.now(),
      transcriptMessageId: null,
    });
  }
}
