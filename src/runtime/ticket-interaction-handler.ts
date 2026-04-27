import {
  createChannelMessage,
  createTicketChannel,
  deleteChannel,
  uploadTranscriptToChannel,
} from "../discord";
import { buildEphemeralMessage } from "../discord-interactions";
import {
  buildTicketChannelName,
  buildTicketCloseConfirmCustomId,
  buildTicketCloseCustomId,
  buildTicketCloseDeclineCustomId,
  buildTicketCloseRequestCustomId,
  buildTicketModalResponse,
  buildTicketTranscriptSummaryEmbed,
  extractTicketAnswersFromModal,
  formatTicketNumber,
  parseTicketCustomId,
  renderTicketTranscript,
} from "../tickets";
import type { TicketInstance, TicketPanelConfig, TicketTypeConfig } from "../types";
import type { DiscordInteraction } from "./app-types";
import type { RuntimeStore, TicketTranscriptBlobStore } from "./contracts";
import { buildTicketTranscriptArtifacts } from "./ticket-transcript-collector";

export async function handleMessageComponentInteraction(
  interaction: DiscordInteraction,
  store: RuntimeStore,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This interaction can only be used inside a server."));
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
    const panel = await store.readTicketPanelConfig(interaction.guild_id);
    const ticketType = panel?.ticketTypes.find((entry) => entry.id === parsedCustomId.ticketTypeId);
    if (!panel || !ticketType) {
      return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
    }

    const openerUserId = getInteractionUserId(interaction);
    if (!openerUserId) {
      return Response.json(buildEphemeralMessage("Could not determine which user opened this ticket."));
    }

    if (ticketType.questions.length === 0) {
      return createTicketFromInteraction({
        guildId: interaction.guild_id,
        openerUserId,
        panel,
        ticketType,
        answers: [],
        store,
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
        store,
        discordBotToken
      );
    case "close-confirm":
      return handleTicketCloseConfirmationInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        store,
        discordBotToken,
        requestOrigin,
        ticketTranscriptBlobs
      );
    case "close-decline":
      return handleTicketCloseDeclineInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        store
      );
    case "close":
      return handleTicketCloseInteraction(
        interaction,
        interaction.guild_id,
        parsedCustomId.channelId,
        store,
        discordBotToken,
        requestOrigin,
        ticketTranscriptBlobs
      );
    default:
      return Response.json(buildEphemeralMessage("Unsupported interaction."));
  }
}

export async function handleTicketModalSubmitInteraction(
  interaction: DiscordInteraction,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  if (typeof interaction.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This interaction can only be used inside a server."));
  }

  const openerUserId = getInteractionUserId(interaction);
  if (!openerUserId) {
    return Response.json(buildEphemeralMessage("Could not determine which user opened this ticket."));
  }

  const parsedCustomId = parseTicketCustomId(getInteractionCustomId(interaction) ?? "");
  if (!parsedCustomId || parsedCustomId.action !== "open") {
    return Response.json(buildEphemeralMessage("That ticket option is no longer available."));
  }

  const panel = await store.readTicketPanelConfig(interaction.guild_id);
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
      ticketType.questions
    ),
    store,
    discordBotToken,
  });
}

async function createTicketFromInteraction({
  guildId,
  openerUserId,
  panel,
  ticketType,
  answers,
  store,
  discordBotToken,
}: {
  guildId: string;
  openerUserId: string;
  panel: TicketPanelConfig;
  ticketType: TicketTypeConfig;
  answers: TicketInstance["answers"];
  store: RuntimeStore;
  discordBotToken: string;
}): Promise<Response> {
  const config = await store.readConfig();
  let ticketNumber: number;

  try {
    ticketNumber = await store.reserveNextTicketNumber(guildId);
  } catch (error) {
    console.error("Failed to reserve ticket number", error);
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }

  let channel: Awaited<ReturnType<typeof createTicketChannel>>;
  try {
    channel = await createTicketChannel(
      {
        guildId,
        name: buildTicketChannelName(ticketType.channelNamePrefix, ticketNumber),
        parentId: panel.categoryChannelId,
        botUserId: config.botUserId,
        openerUserId,
        supportRoleId: ticketType.supportRoleId,
      },
      discordBotToken
    );
  } catch (error) {
    console.error("Failed to create ticket channel", error);
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }

  const instance: TicketInstance = {
    guildId,
    channelId: channel.id,
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

  let persisted = false;
  try {
    await store.createTicketInstance(instance);
    persisted = true;
    await createChannelMessage(
      channel.id,
      buildTicketOpeningMessage(instance, ticketNumber),
      discordBotToken
    );
  } catch (error) {
    console.error("Failed to finish ticket creation", error);
    if (persisted) {
      try {
        await store.deleteTicketInstance({
          guildId,
          channelId: channel.id,
        });
      } catch (rollbackError) {
        console.error("Failed to roll back ticket instance", rollbackError);
      }
    }
    try {
      await deleteChannel(channel.id, discordBotToken);
    } catch (deleteError) {
      console.error("Failed to delete ticket channel after open failure", deleteError);
    }
    return Response.json(buildEphemeralMessage("Failed to create your ticket."));
  }

  return Response.json(buildEphemeralMessage(`Created your ticket: <#${channel.id}>`));
}

async function handleTicketCloseInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  store: RuntimeStore,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is closing this ticket."));
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close button is no longer valid."));
  }

  const ticket = await store.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  const memberRoleIds = getInteractionMemberRoles(interaction);
  const canClose =
    ticket.openerUserId === userId ||
    (ticket.supportRoleId !== null && memberRoleIds.includes(ticket.supportRoleId));
  if (!canClose) {
    return Response.json(
      buildEphemeralMessage("Only the ticket opener or the configured support role can close this ticket.")
    );
  }

  return closeTicket({
    ticket,
    closedByUserId: userId,
    closerDisplayName: getInteractionUserDisplayName(interaction),
    store,
    discordBotToken,
    requestOrigin,
    ticketTranscriptBlobs,
  });
}

async function handleTicketCloseRequestInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  store: RuntimeStore,
  discordBotToken: string
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is requesting a ticket close."));
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close request button is no longer valid."));
  }

  const ticket = await store.readOpenTicketByChannel(guildId, channelId);
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
        "Only the configured support role can request that the ticket opener close this ticket."
      )
    );
  }

  try {
    await createChannelMessage(
      channelId,
      buildTicketCloseRequestMessage(ticket, userId),
      discordBotToken
    );
  } catch (error) {
    console.error("Failed to post ticket close request", error);
    return Response.json(buildEphemeralMessage("Failed to request confirmation from the ticket opener."));
  }

  return Response.json(buildEphemeralMessage("Requested confirmation from the ticket opener."));
}

async function handleTicketCloseConfirmationInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  store: RuntimeStore,
  discordBotToken: string,
  requestOrigin: string,
  ticketTranscriptBlobs?: TicketTranscriptBlobStore
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is responding to this ticket close request."));
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close request is no longer valid."));
  }

  const ticket = await store.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  if (ticket.openerUserId !== userId) {
    return Response.json(buildEphemeralMessage("Only the ticket opener can approve this close request."));
  }

  return closeTicket({
    ticket,
    closedByUserId: userId,
    closerDisplayName: getInteractionUserDisplayName(interaction),
    store,
    discordBotToken,
    requestOrigin,
    ticketTranscriptBlobs,
  });
}

async function handleTicketCloseDeclineInteraction(
  interaction: DiscordInteraction,
  guildId: string,
  requestedChannelId: string,
  store: RuntimeStore
): Promise<Response> {
  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine who is responding to this ticket close request."));
  }

  const channelId = resolveTicketChannelId(interaction, requestedChannelId);
  if (!channelId) {
    return Response.json(buildEphemeralMessage("That ticket close request is no longer valid."));
  }

  const ticket = await store.readOpenTicketByChannel(guildId, channelId);
  if (!ticket) {
    return Response.json(buildEphemeralMessage("This ticket is already closed or missing."));
  }

  if (ticket.openerUserId !== userId) {
    return Response.json(buildEphemeralMessage("Only the ticket opener can decline this close request."));
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
  store,
  discordBotToken,
  requestOrigin,
  ticketTranscriptBlobs,
}: {
  ticket: TicketInstance;
  closedByUserId: string;
  closerDisplayName: string | null;
  store: RuntimeStore;
  discordBotToken: string;
  requestOrigin: string;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}): Promise<Response> {
  const guildId = ticket.guildId;
  const channelId = ticket.channelId;

  const panel = await store.readTicketPanelConfig(guildId);
  if (!panel) {
    return Response.json(buildEphemeralMessage("This ticket panel configuration is missing."));
  }

  const closedAtMs = Date.now();
  const closingTicket: TicketInstance = {
    ...ticket,
    status: "closed",
    closedAtMs,
    closedByUserId,
  };
  let transcriptMessageId: string;
  try {
    const transcriptArtifacts = await buildTicketTranscriptArtifacts({
      guildId,
      channelId,
      closingTicket,
      closerDisplayName,
      discordBotToken,
      requestOrigin,
      ticketTranscriptBlobs,
    });
    const transcript = renderTicketTranscript(closingTicket, transcriptArtifacts.messages);

    const transcriptMessage = await uploadTranscriptToChannel(
      panel.transcriptChannelId,
      `ticket-${channelId}.txt`,
      transcript,
      discordBotToken,
      {
        htmlTranscriptUrl: transcriptArtifacts.htmlUrl,
        embeds: [
          buildTicketTranscriptSummaryEmbed(
            closingTicket,
            transcriptArtifacts.messages,
            transcriptArtifacts.presentation
          ),
        ],
      }
    );
    transcriptMessageId = transcriptMessage.id;
  } catch (error) {
    console.error("Failed to upload transcript", error);
    try {
      await createChannelMessage(
        channelId,
        {
          content:
            "Failed to upload the transcript for this ticket. The ticket will remain open so support staff can retry closing it.",
        },
        discordBotToken
      );
    } catch (warningError) {
      console.error("Failed to post transcript warning", warningError);
    }
    return Response.json(
      buildEphemeralMessage(
        "Failed to upload the transcript. The ticket is still open, and a warning was posted in the channel."
      )
    );
  }

  try {
    await store.closeTicketInstance({
      guildId,
      channelId,
      closedByUserId,
      closedAtMs,
      transcriptMessageId,
    });
  } catch (error) {
    console.error("Failed to close ticket", error);
    return Response.json(buildEphemeralMessage("Failed to close the ticket."));
  }

  try {
    await deleteChannel(channelId, discordBotToken);
  } catch (error) {
    console.error("Failed to delete closed ticket channel", error);
    return Response.json(
      buildEphemeralMessage(
        "Closed ticket and uploaded the transcript, but failed to delete the channel. Please clean it up manually."
      )
    );
  }

  return Response.json(buildEphemeralMessage("Closed ticket and uploaded the transcript."));
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
  requestedChannelId: string
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

function buildTicketCloseRequestMessage(ticket: TicketInstance, requesterUserId: string) {
  return {
    content: `<@${ticket.openerUserId}> <@${requesterUserId}> requested to close this ticket. Do you want to close it now?`,
    allowed_mentions: { users: [ticket.openerUserId] },
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: buildTicketCloseConfirmCustomId(ticket.channelId),
            label: "Yes, close ticket",
            style: 4,
          },
          {
            type: 2,
            custom_id: buildTicketCloseDeclineCustomId(ticket.channelId),
            label: "No, keep open",
            style: 2,
          },
        ],
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
