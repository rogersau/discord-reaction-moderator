import { buildTicketCloseConfirmCustomId, buildTicketCloseDeclineCustomId } from "../../tickets";
import type { TicketInstance } from "../../types";

export async function requestTicketClose(
  adapters: {
    createChannelMessage: (
      channelId: string,
      body: {
        content: string;
        allowed_mentions: { users: string[] };
        components: unknown[];
      },
    ) => Promise<void>;
  },
  options: {
    ticket: TicketInstance;
    requesterUserId: string;
  },
): Promise<void> {
  await adapters.createChannelMessage(options.ticket.channelId, {
    content: `<@${options.ticket.openerUserId}> <@${options.requesterUserId}> requested to close this ticket. Do you want to close it now?`,
    allowed_mentions: { users: [options.ticket.openerUserId] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: buildTicketCloseConfirmCustomId(options.ticket.channelId),
            label: "Yes, close ticket",
            style: 4,
          },
          {
            type: 2,
            custom_id: buildTicketCloseDeclineCustomId(options.ticket.channelId),
            label: "No, keep open",
            style: 2,
          },
        ],
      },
    ],
  });
}
