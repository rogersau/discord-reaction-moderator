import {
  createChannelMessage,
  createTicketChannel,
  deleteChannel,
  uploadTranscriptToChannel,
} from "../discord";
import { buildEphemeralMessage } from "../discord-interactions";
import {
  buildTicketCloseCustomId,
  buildTicketCloseRequestCustomId,
  buildTicketModalResponse,
  extractTicketAnswersFromModal,
  formatTicketNumber,
  parseTicketCustomId,
} from "../tickets";
import type { TicketInstance, TicketPanelConfig, TicketTypeConfig } from "../types";
import type { DiscordInteraction } from "./app-types";
import type { RuntimeStores } from "./app-types";
import type { TicketTranscriptBlobStore } from "./contracts";
import { buildTicketTranscriptArtifacts } from "./ticket-transcript-collector";
import { openTicket } from "../services/tickets/open-ticket";
import {
  closeTicket as closeTicketWorkflow,
  TranscriptUploadError,
  ChannelDeletionError,
} from "../services/tickets/close-ticket";
import { requestTicketClose } from "../services/tickets/request-ticket-close";

export async function handleMessageComponentInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore,
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(
      buildEphemeralMessage("This interaction can only be used inside a server."),
    );
  }

  const customId = getInteractionCustomId(interaction);
  if (!customId) {
    return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }

  const parsedCustomId = parseTicketCustomId(customId);
  if (!parsedCustomId) {
    return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }

  if (parsedCustomId.action === "open") {
    const panel = await stores.tickets.readTicketPanelConfig(interaction.guild_id);
    const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsedCustomId.ticketTypeId);
    if (!panel || !ticketType) {
      return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
    }

    const openerUserId = getInteractionUserId(interaction);
    if (!openerUserId) {
      return Response.json(
        buildEphemeralMessage("Could not determine which user opened this ticket."),
      );
    }

    if (ticketType.questions.length === 0) {
      return createTicketFromInteraction({
        guildId: interaction.guild_id,
        openerUserId,
        panel,
        ticketType,
        answers: [],
        stores,
        discordBotToken,
      });
    }

    return Response.json(buildTicketModalResponse(ticketType));
  }

  switch (parsedCustomId.action) {
    case "close-request":
      return handleTicketCloseRequestInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        stores,
        discordBotToken,
      );
    case "close-confirm":
      return handleTicketCloseConfirmationInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        stores,
        discordBotToken,
        requestOrigin,
        ticketTranscriptBlobs,
      );
    case "close-decline":
      return handleTicketCloseDeclineInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        stores,
      );
    case "close":
      return handleTicketCloseInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        stores,
        discordBotToken,
        requestOrigin,
        ticketTranscriptBlobs,
      );
    default:
      return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }
}

export async function handleTicketModalSubmitInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(
      buildEphemeralMessage("This interaction can only be used inside a server."),
    );
  }

  const openerUserId = getInteractionUserId(interaction);
  if (!openerUserId) {
    return Response.json(
      buildEphemeralMessage("Could not determine which user opened this ticket."),
    );
  }

  const parsedCustomId = parseTicketCustomId(getInteractionCustomId(interaction) ?? "");
  if (!parsedCustomId || parsedCustomId.action !== "open") {
    return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
  }

  const panel = await stores.tickets.readTicketPanelConfig(interaction.guild_id);
  const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsedCustomId.ticketTypeId);
  if (!panel || !ticketType) {
    return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
  }

  return createTicketFromInteraction({
    guildId: interaction.guild_id,
    openerUserId,
    panel,
    ticketType,
    answers: extractTicketAnswersFromModal(
      interaction as Parameters<typeof extractTicketAnswersFromModal>[0],
      ticketType.questions,
    ),
    stores,
    discordBotToken,
  });
}

async function createTicketFromInteraction({
  guildId,
  openerUserId,
  panel,
  ticketType,
  answers,
  stores,
  discordBotToken,
}: {
  guildId: string;
  openerUserId: string;
  panel: TicketPanelConfig;
  ticketType: TicketTypeConfig;
  answers: TicketInstance["answers"];
  stores: RuntimeStores;
  discordBotToken: string;
}): Promise<Response> {
  try {
    const instance = await openTicket(
      {
        readConfig: () => stores.blocklist.readConfig(),
        reserveNextTicketNumber: (gId: string) => stores.tickets.reserveNextTicketNumber(gId),
        createTicketInstance: (inst: TicketInstance) => stores.tickets.createTicketInstance(inst),
        deleteTicketInstance: (body: { guildId: string; channelId: string }) =>
          stores.tickets.deleteTicketInstance(body),
      },
      {
        createChannel: async (config) => {
          const channel = await createTicketChannel(config, discordBotToken);
          return { id: channel.id };
        },
        deleteChannel: async (channelId: string) => {
          await deleteChannel(channelId, discordBotToken);
        },
        createOpeningMessage: async (channelId: string, ticketNumber: number) => {
          const inst: TicketInstance = {
            guildId,
            channelId,
            ticketTypeId: ticketType.id,
            ticketTypeLabel: ticketType.label,
            openerUserId,
            supportRoleId: ticketType.supportRoleId,
            status: "open",
            answers,
            openedAtMs: Date.now(),
            closedAtMs: null,
            closedByUserId: null,
            transcriptMessageId: null,
          };
          await createChannelMessage(
            channelId,
            buildTicketOpeningMessage(inst, ticketNumber),
            discordBotToken,
          );
        },
      },
      {
        guildId,
        openerUserId,
        panel,
        ticketType,
        answers,
      },
    );
    return Response.json(buildEphemeralMessage(`Created your ticket: <#${instance.channelId}>`));
  } catch (error) {
    console.error("Failed to create ticket", error);
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }
}

async function handleTicketCloseInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  stores: RuntimeStores,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore,
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is closing this ticket."));
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close button is no longer valid."));
  }

  const ticket = await stores.tickets.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  const memberRoleIds = getInteractionMemberRoles(interaction);
  const canClose =
    ticket.openerUserId === userId ||
    (ticket.supportRoleId !== null && memberRoleIds.includes(ticket.supportRoleId));
  if (!canClose) {
    return Response.json(
      buildEphemeralMessage(
        "Only the ticket opener or the configured support role can close this ticket.",
      ),
    );
  }

  return closeTicket({
    ticket,
    closedByUserId: userId,
    closerDisplayName: getInteractionUserDisplayName(interaction),
    stores,
    discordBotToken,
    requestOrigin,
    ticketTranscriptBlobs,
  });
}

async function handleTicketCloseRequestInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(
      buildEphemeralMessage("Could not determine who is requesting a ticket close."),
    );
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(
      buildEphemeralMessage("That ticket close request button is no longer valid."),
    );
  }

  const ticket = await stores.tickets.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  if (ticket.openerUserId === userId) {
    return Response.json(buildEphemeralMessage("You can close your own ticket directly."));
  }

  const memberRoleIds = getInteractionMemberRoles(interaction);
  const canRequestClose =
    ticket.supportRoleId !== null && memberRoleIds.includes(ticket.supportRoleId);
  if (!canRequestClose) {
    return Response.json(
      buildEphemeralMessage(
        "Only the configured support role can request that the ticket opener close this ticket.",
      ),
    );
  }

  try {
    await requestTicketClose(
      {
        createChannelMessage: async (channelId, body) => {
          await createChannelMessage(channelId, body, discordBotToken);
        },
      },
      {
        ticket,
        requesterUserId: userId,
      },
    );
  } catch (error) {
    console.error("Failed to post ticket close request", error);
    return Response.json(
      buildEphemeralMessage("Failed to request confirmation from the ticket opener."),
    );
  }

  return Response.json(buildEphemeralMessage("Requested confirmation from the ticket opener."));
}

async function handleTicketCloseConfirmationInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  stores: RuntimeStores,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore,
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(
      buildEphemeralMessage("Could not determine who is responding to this ticket close request."),
    );
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close request is no longer valid."));
  }

  const ticket = await stores.tickets.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  if (ticket.openerUserId !== userId) {
    return Response.json(
      buildEphemeralMessage("Only the ticket opener can approve this close request."),
    );
  }

  return closeTicket({
    ticket,
    closedByUserId: userId,
    closerDisplayName: getInteractionUserDisplayName(interaction),
    stores,
    discordBotToken,
    requestOrigin,
    ticketTranscriptBlobs,
  });
}

async function handleTicketCloseDeclineInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  stores: RuntimeStores,
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(
      buildEphemeralMessage("Could not determine who is responding to this ticket close request."),
    );
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close request is no longer valid."));
  }

  const ticket = await stores.tickets.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  if (ticket.openerUserId !== userId) {
    return Response.json(
      buildEphemeralMessage("Only the ticket opener can decline this close request."),
    );
  }

  return Response.json({
    type: 7,
    data: {
      content: "The ticket opener chose to keep this ticket open.",
      allowed_mentions: { parse: [] },
      components: [],
    },
  });
}

async function closeTicket({
  ticket,
  closedByUserId,
  closerDisplayName,
  stores,
  discordBotToken,
  requestOrigin,
  ticketTranscriptBlobs,
}: {
  ticket: TicketInstance;
  closedByUserId: string;
  closerDisplayName: string | null;
  stores: RuntimeStores;
  discordBotToken: string;
  requestOrigin: string;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}): Promise<Response> {
  const panel = await stores.tickets.readTicketPanelConfig(ticket.guildId);
  if (!panel) {
    return Response.json(buildEphemeralMessage("This ticket panel configuration is missing."));
  }

  try {
    await closeTicketWorkflow(
      {
        closeTicketInstance: (body) => stores.tickets.closeTicketInstance(body),
      },
      {
        deleteChannel: async (channelId) => {
          await deleteChannel(channelId, discordBotToken);
        },
        uploadTranscript: async (transcriptChannelId, filename, transcript, options) => {
          return await uploadTranscriptToChannel(
            transcriptChannelId,
            filename,
            transcript,
            discordBotToken,
            options,
          );
        },
        buildTranscriptArtifacts: async (options) => {
          return await buildTicketTranscriptArtifacts({
            ...options,
            discordBotToken,
            requestOrigin,
          });
        },
        createChannelMessage: async (channelId, body) => {
          await createChannelMessage(channelId, body, discordBotToken);
        },
      },
      {
        ticket,
        closedByUserId,
        closerDisplayName,
        panel,
        ticketTranscriptBlobs,
      },
    );
    return Response.json(buildEphemeralMessage("Closed ticket and uploaded the transcript."));
  } catch (error) {
    console.error("Failed to close ticket", error);
    if (error instanceof TranscriptUploadError) {
      return Response.json(
        buildEphemeralMessage(
          "Failed to upload the transcript. The ticket is still open, and a warning was posted in the channel.",
        ),
      );
    }
    if (error instanceof ChannelDeletionError) {
      return Response.json(
        buildEphemeralMessage(
          "Closed ticket and uploaded the transcript, but failed to delete the channel. Please clean it up manually.",
        ),
      );
    }
    return Response.json(buildEphemeralMessage("Failed to close the ticket."));
  }
}

function getInteractionCustomId(interaction: DiscordInteraction): string | null {
  if (!isRecord(interaction.data)) {
    return null;
  }

  return asOptionalString(interaction.data.custom_id);
}

function getInteractionUserId(interaction: DiscordInteraction): string | null {
  return asOptionalString(interaction.member?.user?.id) ?? asOptionalString(interaction.user?.id);
}

function getInteractionUserDisplayName(interaction: DiscordInteraction): string | null {
  return (
    asOptionalString(interaction.member?.user?.global_name) ??
    asOptionalString(interaction.member?.user?.username) ??
    asOptionalString(interaction.user?.global_name) ??
    asOptionalString(interaction.user?.username)
  );
}

function getInteractionMemberRoles(interaction: DiscordInteraction): string[] {
  if (!Array.isArray(interaction.member?.roles)) {
    return [];
  }

  return interaction.member.roles.filter((roleId): roleId is string => typeof roleId === "string");
}

function resolveTicketChannelId(
  interaction: DiscordInteraction,
  requestedChannelId: string,
): string | null {
  const channelId =
    typeof interaction.channel_id === "string" && interaction.channel_id.length > 0
      ? interaction.channel_id
      : requestedChannelId;

  return channelId === requestedChannelId ? channelId : null;
}

function buildTicketOpeningMessage(instance: TicketInstance, ticketNumber: number) {
  const fields =
    instance.answers.length === 0
      ? [{ name: "Submitted Answers", value: "No answers provided." }]
      : instance.answers.map((answer) => ({
          name: answer.label,
          value: answer.value || "(blank)",
        }));
  const actionButtons: Array<{
    type: 2;
    custom_id: string;
    label: string;
    style: 2 | 4;
  }> = [];

  if (instance.supportRoleId) {
    actionButtons.push({
      type: 2,
      custom_id: buildTicketCloseRequestCustomId(instance.channelId),
      label: "Request Close",
      style: 2,
    });
  }

  actionButtons.push({
    type: 2,
    custom_id: buildTicketCloseCustomId(instance.channelId),
    label: "Close Ticket",
    style: 4,
  });

  return {
    content: `<@${instance.openerUserId}>`,
    allowed_mentions: { users: [instance.openerUserId] },
    embeds: [
      {
        title: `${instance.ticketTypeLabel} Ticket #${formatTicketNumber(ticketNumber)}`,
        color: 0x2ecc71,
        fields: [{ name: "User", value: `<@${instance.openerUserId}>` }, ...fields],
        footer: { text: `Ticket type: ${instance.ticketTypeId}` },
        timestamp: new Date(instance.openedAtMs).toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: actionButtons,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
