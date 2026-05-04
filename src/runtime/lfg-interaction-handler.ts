import {
  createChannelMessage,
  createUserDmMessage,
  deleteChannelMessage,
  editChannelMessage,
} from "../discord";
import { buildEphemeralMessage } from "../discord-interactions";
import {
  buildLfgPostModal,
  buildLfgServerResponse,
  parseLfgCustomId,
} from "../lfg";
import {
  LfgActivePostError,
  LfgConfigError,
  LfgService,
} from "../services/lfg-service";
import type { DiscordInteraction, RuntimeStores } from "./app-types";

export async function handleLfgComponentInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  const customId = getInteractionCustomId(interaction);
  const parsed = customId ? parseLfgCustomId(customId) : null;
  if (!parsed || typeof interaction.guild_id !== "string") {
    return Response.json(buildEphemeralMessage("Unsupported LFG interaction."));
  }

  const userId = getInteractionUserId(interaction);
  if (!userId) {
    return Response.json(buildEphemeralMessage("Could not determine your Discord user."));
  }

  const service = createLfgService(stores, discordBotToken);

  if (parsed.action === "create") {
    try {
      if (await stores.lfg.readActiveLfgPostByOwner(interaction.guild_id, userId)) {
        return Response.json(
          buildEphemeralMessage(
            "You already have an active LFG post. Please close it before creating another.",
          ),
        );
      }
      return Response.json(
        buildLfgServerResponse(await service.getConfig(interaction.guild_id)),
      );
    } catch (error) {
      console.error("Failed to start LFG post", error);
      return Response.json(buildEphemeralMessage("Failed to start LFG post creation."));
    }
  }

  if (parsed.action === "server") {
    return Response.json(buildLfgPostModal(parsed.serverId));
  }

  if (parsed.action === "interested") {
    const post = await stores.lfg.readLfgPost(interaction.guild_id, parsed.postId);
    if (!post || !post.active) {
      return Response.json(buildEphemeralMessage("This LFG post is no longer active."));
    }
    if (post.ownerId === userId) {
      return Response.json(
        buildEphemeralMessage("You cannot mark yourself as interested in your own post."),
      );
    }
    try {
      const result = await service.notifyOwner({
        guildId: interaction.guild_id,
        postId: parsed.postId,
        interestedUserId: userId,
        interestedUserDisplayName: getInteractionUserDisplayName(interaction),
      });
      return Response.json(
        buildEphemeralMessage(
          result.dmSent
            ? "The original poster has been notified that you are interested."
            : "You have been marked as interested, but I could not DM the original poster. They may have DMs turned off.",
        ),
      );
    } catch (error) {
      return Response.json(buildEphemeralMessage(describeLfgError(error)));
    }
  }

  if (parsed.action === "close") {
    const post = await stores.lfg.readLfgPost(interaction.guild_id, parsed.postId);
    if (!post || !post.active) {
      return Response.json(buildEphemeralMessage("This post is already closed or could not be found."));
    }
    const canClose =
      post.ownerId === userId ||
      hasManageMessagesPermission(interaction.member?.permissions ?? "");
    if (!canClose) {
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
      return Response.json(buildEphemeralMessage("LFG post closed."));
    } catch (error) {
      console.error("Failed to close LFG post", error);
      return Response.json(buildEphemeralMessage("Failed to close LFG post."));
    }
  }

  return Response.json(buildEphemeralMessage("Unsupported LFG interaction."));
}

export async function handleLfgModalSubmitInteraction(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
): Promise<Response> {
  const parsed = parseLfgCustomId(getInteractionCustomId(interaction) ?? "");
  if (!parsed || parsed.action !== "modal" || typeof interaction.guild_id !== "string") {
    return Response.json(buildEphemeralMessage("Unsupported LFG form."));
  }
  const userId = getInteractionUserId(interaction);
  const channelId = interaction.channel_id;
  if (!userId || !channelId) {
    return Response.json(buildEphemeralMessage("Could not create LFG post here."));
  }

  const fields = extractModalFields(interaction);
  try {
    await createLfgService(stores, discordBotToken).createPost({
      guildId: interaction.guild_id,
      channelId,
      ownerId: userId,
      ownerDisplayName: getInteractionUserDisplayName(interaction),
      serverId: parsed.serverId,
      whenPlay: fields.when_play ?? "",
      lookingFor: fields.looking_for ?? "",
      extraInfo: fields.extra_info ?? "",
    });
    return Response.json(buildEphemeralMessage("LFG post created."));
  } catch (error) {
    return Response.json(buildEphemeralMessage(describeLfgError(error)));
  }
}

function createLfgService(
  stores: RuntimeStores,
  discordBotToken: string,
): LfgService {
  return new LfgService(stores.lfg, {
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

function describeLfgError(error: unknown): string {
  if (error instanceof LfgActivePostError || error instanceof LfgConfigError) {
    return error.message;
  }
  console.error("LFG interaction failed", error);
  return "Something went wrong with LFG. Please contact an admin.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const MANAGE_MESSAGES_PERMISSION = 1n << 13n;

function hasManageMessagesPermission(permissions: string): boolean {
  try {
    const perms = BigInt(permissions);
    return (perms & MANAGE_MESSAGES_PERMISSION) !== 0n;
  } catch {
    return false;
  }
}
