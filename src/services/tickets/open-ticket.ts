import { buildTicketChannelName } from "../../tickets";
import type { BlocklistStore, TicketStore } from "../../runtime/contracts";
import type { TicketInstance } from "../../types";
import type { CreateTicketChannelConfig, TicketServiceOptions } from "../ticket-service";

export async function openTicket(
  store: Pick<
    TicketStore,
    "reserveNextTicketNumber" | "createTicketInstance" | "deleteTicketInstance"
  > &
    Pick<BlocklistStore, "readConfig">,
  adapters: {
    createChannel: (config: CreateTicketChannelConfig) => Promise<{ id: string }>;
    deleteChannel: (channelId: string) => Promise<void>;
    createOpeningMessage: (
      channelId: string,
      ticketNumber: number,
      body: {
        content: string;
        allowed_mentions: { parse: []; users: string[] };
        components: unknown[];
      },
    ) => Promise<void>;
  },
  options: TicketServiceOptions,
): Promise<TicketInstance> {
  const config = await store.readConfig();
  const ticketNumber = await store.reserveNextTicketNumber(options.guildId);
  const channel = await adapters.createChannel({
    guildId: options.guildId,
    name: buildTicketChannelName(options.ticketType.channelNamePrefix, ticketNumber),
    parentId: options.panel.categoryChannelId,
    botUserId: config.botUserId,
    openerUserId: options.openerUserId,
    supportRoleId: options.ticketType.supportRoleId,
  });

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

  let persisted = false;
  try {
    await store.createTicketInstance(instance);
    persisted = true;
    await adapters.createOpeningMessage(channel.id, ticketNumber, {
      content: `Created ticket #${ticketNumber} for <@${options.openerUserId}>.`,
      allowed_mentions: { parse: [], users: [options.openerUserId] },
      components: [],
    });
    return instance;
  } catch (error) {
    if (persisted) {
      try {
        await store.deleteTicketInstance({
          guildId: options.guildId,
          channelId: channel.id,
        });
      } catch (rollbackError) {
        console.error("Failed to roll back ticket instance", rollbackError);
      }
    }
    try {
      await adapters.deleteChannel(channel.id);
    } catch (deleteError) {
      console.error("Failed to delete ticket channel after open failure", deleteError);
    }
    throw error;
  }
}
