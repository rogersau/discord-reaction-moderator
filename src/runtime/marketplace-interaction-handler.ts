import {
  createChannelMessage,
  createUserDmMessage,
  deleteChannelMessage,
  editChannelMessage,
} from "../discord";
import { buildEphemeralMessage, hasGuildAdminPermission } from "../discord-interactions";
import {
  buildMarketplacePostModal,
  buildMarketplaceServerResponse,
  buildMarketplaceTypeResponse,
  buildMarketplaceWarningResponse,
  parseMarketplaceCustomId,
} from "../marketplace";
import {
  MarketplaceActivePostError,
  MarketplaceConfigError,
  MarketplaceService,
} from "../services/marketplace-service";
import type { DiscordInteraction, RuntimeStores } from "./app-types";

export async function handleMarketplaceComponentInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  const customId = getInteractionCustomId(interaction);
  const parsed = customId ? parseMarketplaceCustomId(customId) : null;
  if (!parsed || typeof interaction.guild_id !== "string") {
    return Response.json(buildEphemeralMessage("Unsupported marketplace interaction."));
  }

  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine your Discord user."));
  }

  const service = createMarketplaceService(stores, discordBotToken);

  if (parsed.action === "create") {
    try {
      if (await stores.marketplace.readActiveMarketplacePostByOwner(interaction.guild_id, userId)) {
        return Response.json(
          buildEphemeralMessage(
            "You already have an active marketplace post. Please close it before creating another.",
          ),
        );
      }
      return Response.json(buildMarketplaceTypeResponse());
    } catch (error) {
      console.error("Failed to start marketplace post", error);
      return Response.json(buildEphemeralMessage("Failed to start marketplace post creation."));
    }
  }

  if (parsed.action === "type") {
    return Response.json(
      buildMarketplaceServerResponse(
        await service.getConfig(interaction.guild_id),
        parsed.tradeType,
      ),
    );
  }

  if (parsed.action === "server") {
    return Response.json(buildMarketplacePostModal(parsed.tradeType, parsed.serverId));
  }

  if (parsed.action === "business") {
    const post = await stores.marketplace.readMarketplacePost(interaction.guild_id, parsed.postId);
    if (!post || !post.active) {
      return Response.json(buildEphemeralMessage("This marketplace post is no longer active."));
    }
    if (post.ownerId === userId) {
      return Response.json(buildEphemeralMessage("You cannot do business with your own post."));
    }
    return Response.json(buildMarketplaceWarningResponse(parsed.postId));
  }

  if (parsed.action === "confirm") {
    try {
      const result = await service.confirmBusiness({
        guildId: interaction.guild_id,
        postId: parsed.postId,
        buyerId: userId,
        buyerDisplayName: getInteractionUserDisplayName(interaction),
      });
      return Response.json(
        buildEphemeralMessage(
          result.dmSent
            ? "✅ The poster has been notified by DM. This action has been logged for admins."
            : "⚠️ I logged your interest, but I could not DM the poster. They may have DMs disabled. Please contact an admin if needed.",
        ),
      );
    } catch (error) {
      return Response.json(buildEphemeralMessage(describeMarketplaceError(error)));
    }
  }

  if (parsed.action === "close") {
    const post = await stores.marketplace.readMarketplacePost(interaction.guild_id, parsed.postId);
    if (!post || !post.active) {
      return Response.json(
        buildEphemeralMessage("This post is already closed or could not be found."),
      );
    }
    if (
      post.ownerId !== userId &&
      !hasGuildAdminPermission(interaction.member?.permissions ?? "")
    ) {
      return Response.json(
        buildEphemeralMessage("Only the original poster or admins can close this post."),
      );
    }
    try {
      await service.closePost({
        guildId: interaction.guild_id,
        postId: parsed.postId,
        closedByUserId: userId,
      });
      return Response.json(buildEphemeralMessage("Marketplace post closed."));
    } catch (error) {
      console.error("Failed to close marketplace post", error);
      return Response.json(buildEphemeralMessage("Failed to close marketplace post."));
    }
  }

  return Response.json(buildEphemeralMessage("Unsupported marketplace interaction."));
}

export async function handleMarketplaceModalSubmitInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  const parsed = parseMarketplaceCustomId(getInteractionCustomId(interaction) ?? "");
  if (!parsed || parsed.action !== "modal" || typeof interaction.guild_id !== "string") {
    return Response.json(buildEphemeralMessage("Unsupported marketplace form."));
  }
  const userId = getInteractionUserId(interaction);
  const channelId = interaction.channel_id;
  if (!userId || !channelId) {
    return Response.json(buildEphemeralMessage("Could not create marketplace post here."));
  }

  const fields = extractModalFields(interaction);
  try {
    await createMarketplaceService(stores, discordBotToken).createPost({
      guildId: interaction.guild_id,
      channelId,
      ownerId: userId,
      ownerDisplayName: getInteractionUserDisplayName(interaction),
      tradeType: parsed.tradeType,
      serverId: parsed.serverId,
      have: fields.have ?? "",
      want: fields.want ?? "",
      extra: fields.extra ?? "",
    });
    return Response.json(buildEphemeralMessage("Marketplace post created."));
  } catch (error) {
    return Response.json(buildEphemeralMessage(describeMarketplaceError(error)));
  }
}

function createMarketplaceService(
  stores: RuntimeStores,
  discordBotToken: string,
): MarketplaceService {
  return new MarketplaceService(stores.marketplace, {
    createChannelMessage: (channelId, body) =>
      createChannelMessage(channelId, body, discordBotToken),
    editChannelMessage: (channelId, messageId, body) =>
      editChannelMessage(channelId, messageId, body, discordBotToken),
    deleteChannelMessage: (channelId, messageId) =>
      deleteChannelMessage(channelId, messageId, discordBotToken),
    createUserDmMessage: (userId, body) => createUserDmMessage(userId, body, discordBotToken),
  });
}

function getInteractionCustomId(interaction: DiscordInteraction): string | null {
  return isRecord(interaction.data) && typeof interaction.data.custom_id === "string"
    ? interaction.data.custom_id
    : null;
}

function getInteractionUserId(interaction: DiscordInteraction): string | null {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

function getInteractionUserDisplayName(interaction: DiscordInteraction): string {
  return (
    interaction.member?.user?.global_name ??
    interaction.member?.user?.username ??
    interaction.user?.global_name ??
    interaction.user?.username ??
    "Unknown user"
  );
}

function extractModalFields(interaction: DiscordInteraction): Record<string, string> {
  const fields: Record<string, string> = {};
  if (!isRecord(interaction.data) || !Array.isArray(interaction.data.components)) return fields;

  for (const row of interaction.data.components) {
    if (!isRecord(row) || !Array.isArray(row.components)) continue;
    for (const component of row.components) {
      if (!isRecord(component) || typeof component.custom_id !== "string") continue;
      fields[component.custom_id] = typeof component.value === "string" ? component.value : "";
    }
  }
  return fields;
}

function describeMarketplaceError(error: unknown): string {
  if (error instanceof MarketplaceActivePostError || error instanceof MarketplaceConfigError) {
    return error.message;
  }
  console.error("Marketplace interaction failed", error);
  return "Something went wrong with marketplace. Please contact an admin.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
