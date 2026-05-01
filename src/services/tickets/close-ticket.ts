import { renderTicketTranscript, buildTicketTranscriptSummaryEmbed } from "../../tickets";
import type { TicketStore } from "../../runtime/contracts";
import type { TicketInstance, TicketPanelConfig } from "../../types";
import type { TicketTranscriptBlobStore } from "../../runtime/contracts";
import type { TicketTranscriptMessage, TicketTranscriptPresentationOptions } from "../../tickets";
import type { DiscordEmbed } from "../../discord/messages";

export interface CloseTicketTranscriptArtifacts {
  messages: TicketTranscriptMessage[];
  presentation: TicketTranscriptPresentationOptions;
  htmlUrl?: string;
}

export class TranscriptUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptUploadError";
  }
}

export class ChannelDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChannelDeletionError";
  }
}

export async function closeTicket(
  store: Pick<TicketStore, "closeTicketInstance">,
  adapters: {
    deleteChannel: (channelId: string) => Promise<void>;
    uploadTranscript: (
      transcriptChannelId: string,
      filename: string,
      transcript: string,
      options: {
        htmlTranscriptUrl?: string;
        embeds?: DiscordEmbed[];
      },
    ) => Promise<{ id: string }>;
    buildTranscriptArtifacts: (options: {
      guildId: string;
      channelId: string;
      closingTicket: TicketInstance;
      closerDisplayName: string | null;
      ticketTranscriptBlobs?: TicketTranscriptBlobStore;
    }) => Promise<CloseTicketTranscriptArtifacts>;
    createChannelMessage?: (channelId: string, body: { content: string }) => Promise<void>;
  },
  options: {
    ticket: TicketInstance;
    closedByUserId: string;
    closerDisplayName: string | null;
    panel: TicketPanelConfig;
    ticketTranscriptBlobs?: TicketTranscriptBlobStore;
  },
): Promise<void> {
  const closedAtMs = Date.now();
  const closingTicket: TicketInstance = {
    ...options.ticket,
    status: "closed",
    closedAtMs,
    closedByUserId: options.closedByUserId,
  };

  let transcriptMessageId: string;
  try {
    const transcriptArtifacts = await adapters.buildTranscriptArtifacts({
      guildId: options.ticket.guildId,
      channelId: options.ticket.channelId,
      closingTicket,
      closerDisplayName: options.closerDisplayName,
      ticketTranscriptBlobs: options.ticketTranscriptBlobs,
    });
    const transcript = renderTicketTranscript(closingTicket, transcriptArtifacts.messages);

    const transcriptMessage = await adapters.uploadTranscript(
      options.panel.transcriptChannelId,
      `ticket-${options.ticket.channelId}.txt`,
      transcript,
      {
        htmlTranscriptUrl: transcriptArtifacts.htmlUrl,
        embeds: [
          buildTicketTranscriptSummaryEmbed(
            closingTicket,
            transcriptArtifacts.messages,
            transcriptArtifacts.presentation,
          ),
        ],
      },
    );
    transcriptMessageId = transcriptMessage.id;
  } catch (error) {
    console.error("Failed to upload transcript", error);
    if (adapters.createChannelMessage) {
      try {
        await adapters.createChannelMessage(options.ticket.channelId, {
          content:
            "Failed to upload the transcript for this ticket. The ticket will remain open so support staff can retry closing it.",
        });
      } catch (warningError) {
        console.error("Failed to post transcript warning", warningError);
      }
    }
    throw new TranscriptUploadError("Failed to upload transcript");
  }

  await store.closeTicketInstance({
    guildId: options.ticket.guildId,
    channelId: options.ticket.channelId,
    closedByUserId: options.closedByUserId,
    closedAtMs,
    transcriptMessageId,
  });

  try {
    await adapters.deleteChannel(options.ticket.channelId);
  } catch (error) {
    console.error("Failed to delete closed ticket channel", error);
    throw new ChannelDeletionError("Failed to delete channel");
  }
}
