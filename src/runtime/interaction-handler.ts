import { verifyDiscordSignature } from "../discord";
import { buildEphemeralMessage } from "../discord-interactions";
import type { DiscordInteraction, RuntimeAppOptions } from "./app-types";
import { handleApplicationCommand } from "./application-command-handler";
import {
  handleMessageComponentInteraction,
  handleTicketModalSubmitInteraction,
} from "./ticket-interaction-handler";
import {
  handleMarketplaceComponentInteraction,
  handleMarketplaceModalSubmitInteraction,
} from "./marketplace-interaction-handler";
import { handleLfgComponentInteraction, handleLfgModalSubmitInteraction } from "./lfg-interaction-handler";
import { parseMarketplaceCustomId } from "../marketplace";
import { parseLfgCustomId } from "../lfg";

const DISCORD_INTERACTION_MAX_AGE_SECONDS = 5 * 60;

export async function handleInteractionRequest(
  request: Request,
  options: RuntimeAppOptions,
): Promise<Response> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) {
    return new Response("Unauthorized", { status: 401 });
  }

  const verifyDiscordRequest =
    options.verifyDiscordRequest ??
    ((ts: string, rawBody: string, sig: string) =>
      verifyDiscordSignature(options.discordPublicKey, ts, rawBody, sig));

  if (!(await verifyDiscordRequest(timestamp, body, signature))) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isFreshDiscordTimestamp(timestamp)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const interaction = JSON.parse(body) as DiscordInteraction;
  if (interaction?.type === 1) {
    return Response.json({ type: 1 });
  }

  if (interaction?.type === 2) {
    return handleApplicationCommand(interaction, options.stores, options.discordBotToken);
  }

  // Ticket button interactions (open, close, close-request, etc.)
  if (interaction?.type === 3) {
    if (isMarketplaceInteraction(interaction)) {
      return handleMarketplaceComponentInteraction(
        interaction,
        options.stores,
        options.discordBotToken,
      );
    }

    if (isLfgInteraction(interaction)) {
      return handleLfgComponentInteraction(
        interaction,
        options.stores,
        options.discordBotToken,
      );
    }

    return handleMessageComponentInteraction(
      interaction,
      options.stores,
      options.discordBotToken,
      new URL(request.url).origin,
      options.ticketTranscriptBlobs,
    );
  }

  // Ticket modal submissions (ticket creation with questions)
  if (interaction?.type === 5) {
    if (isMarketplaceInteraction(interaction)) {
      return handleMarketplaceModalSubmitInteraction(
        interaction,
        options.stores,
        options.discordBotToken,
      );
    }

    if (isLfgInteraction(interaction)) {
      return handleLfgModalSubmitInteraction(
        interaction,
        options.stores,
        options.discordBotToken,
      );
    }

    return handleTicketModalSubmitInteraction(interaction, options.stores, options.discordBotToken);
  }

  return Response.json(buildEphemeralMessage("Unsupported interaction type."));
}

function isMarketplaceInteraction(interaction: DiscordInteraction): boolean {
  if (typeof interaction.data !== "object" || interaction.data === null) {
    return false;
  }

  const customId = (interaction.data as { custom_id?: unknown }).custom_id;
  return typeof customId === "string" && parseMarketplaceCustomId(customId) !== null;
}

function isLfgInteraction(interaction: DiscordInteraction): boolean {
  if (typeof interaction.data !== "object" || interaction.data === null) {
    return false;
  }

  const customId = (interaction.data as { custom_id?: unknown }).custom_id;
  return typeof customId === "string" && parseLfgCustomId(customId) !== null;
}

function isFreshDiscordTimestamp(timestamp: string): boolean {
  if (!/^\d+$/.test(timestamp)) {
    return false;
  }
  const timestampSeconds = Number.parseInt(timestamp, 10);
  if (!Number.isSafeInteger(timestampSeconds)) {
    return false;
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  return Math.abs(nowSeconds - timestampSeconds) <= DISCORD_INTERACTION_MAX_AGE_SECONDS;
}
