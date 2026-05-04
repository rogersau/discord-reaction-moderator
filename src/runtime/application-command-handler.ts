import { normalizeEmoji } from "../blocklist";
import { addGuildMemberRole, createChannelMessage, removeGuildMemberRole } from "../discord";
import {
  buildEphemeralMessage,
  extractCommandInvocation,
  hasGuildAdminPermission,
} from "../discord-interactions";
import {
  describeTimedRoleAssignmentFailure,
  formatTimedRoleExpiry,
  parseTimedRoleDuration,
} from "../timed-roles";
import { BlocklistService } from "../services/blocklist-service";
import type { GuildNotificationChannelStore } from "../services/activity-log";
import { TimedRoleService } from "../services/timed-role-service";
import { MarketplaceService } from "../services/marketplace-service";
import { LfgService } from "../services/lfg-service";
import { createUserDmMessage, deleteChannelMessage, editChannelMessage } from "../discord/messages";
import { formatMarketplaceLogs } from "../marketplace";
import type { RuntimeStores } from "./app-types";
import type { DiscordInteraction } from "./app-types";
import type { FeatureFlags } from "./features";

const DISCORD_MESSAGE_CONTENT_LIMIT = 2_000;

export async function handleApplicationCommand(
  interaction: DiscordInteraction,
  stores: RuntimeStores,
  discordBotToken: string,
  features: FeatureFlags,
): Promise<Response> {
  if (typeof interaction?.guild_id !== "string" || interaction.guild_id.length === 0) {
    return Response.json(buildEphemeralMessage("This command can only be used inside a server."));
  }
  if (!hasGuildAdminPermission(interaction?.member?.permissions ?? "")) {
    return Response.json(
      buildEphemeralMessage(
        "You need Administrator or Manage Guild permissions to use this command.",
      ),
    );
  }

  const invocation = extractCommandInvocation(interaction);
  if (!invocation) {
    return Response.json(buildEphemeralMessage("Unsupported command."));
  }

  const actor = {
    label: "Slash command",
    userId: interaction.member?.user?.id ?? interaction.user?.id,
  };

  const blocklistService = new BlocklistService(stores.blocklist, (channelId, body) =>
    createChannelMessage(channelId, body, discordBotToken).then(() => undefined),
  );
  const timedRoleService = new TimedRoleService(
    stores.timedRoles,
    discordBotToken,
    (guildId, userId, roleId) => addGuildMemberRole(guildId, userId, roleId, discordBotToken),
    (guildId, userId, roleId) => removeGuildMemberRole(guildId, userId, roleId, discordBotToken),
    stores.blocklist as Partial<GuildNotificationChannelStore>,
    (channelId, body) =>
      createChannelMessage(channelId, body, discordBotToken).then(() => undefined),
  );
  const marketplaceService = new MarketplaceService(stores.marketplace, {
    createChannelMessage: (channelId, body) =>
      createChannelMessage(channelId, body, discordBotToken),
    editChannelMessage: (channelId, messageId, body) =>
      editChannelMessage(channelId, messageId, body, discordBotToken),
    deleteChannelMessage: (channelId, messageId) =>
      deleteChannelMessage(channelId, messageId, discordBotToken),
    createUserDmMessage: (userId, body) => createUserDmMessage(userId, body, discordBotToken),
  });
  const lfgService = new LfgService(stores.lfg, {
    createChannelMessage: (channelId, body) =>
      createChannelMessage(channelId, body, discordBotToken),
    editChannelMessage: (channelId, messageId, body) =>
      editChannelMessage(channelId, messageId, body, discordBotToken),
    deleteChannelMessage: (channelId, messageId) =>
      deleteChannelMessage(channelId, messageId, discordBotToken),
    createUserDmMessage: (userId, body) => createUserDmMessage(userId, body, discordBotToken),
  });

  if (invocation.commandName === "lfg" && invocation.subcommandName === "setup") {
    if (!features.lfg) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    if (!interaction.channel_id) {
      return Response.json(buildEphemeralMessage("Could not determine this channel."));
    }
    try {
      await lfgService.setupNotice(interaction.guild_id, interaction.channel_id);
      return Response.json(
        buildEphemeralMessage(
          "LFG noticeboard button has been created/reset in this channel.",
        ),
      );
    } catch (error) {
      console.error("Failed to setup LFG notice", error);
      return Response.json(buildEphemeralMessage("Failed to setup LFG noticeboard."));
    }
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "list") {
    if (!features.blocklist) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    try {
      const guildConfig = await blocklistService.getGuildBlocklist(interaction.guild_id);
      const effectiveEmojis = guildConfig.enabled === false ? [] : guildConfig.emojis;
      const content = formatBoundedBulletList(
        "Blocked emojis in this server:",
        "No emojis are blocked in this server.",
        effectiveEmojis,
      );
      return Response.json(buildEphemeralMessage(content));
    } catch (error) {
      console.error("Failed to load moderation config", error);
      return Response.json(buildEphemeralMessage("Failed to load the server blocklist."));
    }
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "list") {
    if (!features.timedRoles) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const assignments = await timedRoleService.listTimedRoles(interaction.guild_id);
    const content =
      assignments.length === 0
        ? "No timed roles are active in this server."
        : `Active timed roles:\n${assignments
            .map(
              (assignment) =>
                `- <@${assignment.userId}> -> <@&${assignment.roleId}> (${assignment.durationInput}, expires ${formatTimedRoleExpiry(assignment.expiresAtMs)})`,
            )
            .join("\n")}`;
    return Response.json(buildEphemeralMessage(content));
  }

  if (invocation.commandName === "marketplace" && invocation.subcommandName === "setup") {
    if (!features.marketplace) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    if (!interaction.channel_id) {
      return Response.json(buildEphemeralMessage("Could not determine this channel."));
    }
    try {
      await marketplaceService.setupNotice(interaction.guild_id, interaction.channel_id);
      return Response.json(
        buildEphemeralMessage(
          "Marketplace noticeboard button has been created/reset in this channel.",
        ),
      );
    } catch (error) {
      console.error("Failed to setup marketplace notice", error);
      return Response.json(buildEphemeralMessage("Failed to setup marketplace noticeboard."));
    }
  }

  if (invocation.commandName === "marketplace" && invocation.subcommandName === "logs") {
    if (!features.marketplace) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const amount = Math.min(Math.max(invocation.amount, 1), 20);
    const logs = await marketplaceService.listLogs(interaction.guild_id, amount);
    return Response.json(buildEphemeralMessage(formatMarketplaceLogs(logs)));
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "add") {
    if (!features.timedRoles) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const parsedDuration = parseTimedRoleDuration(invocation.duration, Date.now());
    if (!parsedDuration) {
      return Response.json(
        buildEphemeralMessage("Invalid duration. Use values like 1h, 1w, or 1m."),
      );
    }

    try {
      await timedRoleService.assignTimedRole(
        {
          guildId: interaction.guild_id,
          userId: invocation.userId,
          roleId: invocation.roleId,
          durationInput: parsedDuration.durationInput,
          expiresAtMs: parsedDuration.expiresAtMs,
        },
        actor,
      );
    } catch (error) {
      console.error("Timed role assignment failed", error);
      return Response.json(buildEphemeralMessage(describeTimedRoleAssignmentFailure(error)));
    }

    return Response.json(
      buildEphemeralMessage(
        `Assigned <@&${invocation.roleId}> to <@${invocation.userId}> for ${invocation.duration} (${formatTimedRoleExpiry(parsedDuration.expiresAtMs)}).`,
      ),
    );
  }

  if (invocation.commandName === "timedrole" && invocation.subcommandName === "remove") {
    if (!features.timedRoles) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const assignments = await timedRoleService.listTimedRoles(interaction.guild_id);
    const activeAssignment = assignments.find(
      (entry) => entry.userId === invocation.userId && entry.roleId === invocation.roleId,
    );
    if (!activeAssignment) {
      return Response.json(
        buildEphemeralMessage(
          `<@&${invocation.roleId}> is not currently active for <@${invocation.userId}>.`,
        ),
      );
    }

    try {
      await timedRoleService.removeTimedRole(
        {
          guildId: interaction.guild_id,
          userId: invocation.userId,
          roleId: invocation.roleId,
        },
        actor,
      );
    } catch (error) {
      console.error("Timed role removal failed", error);
      return Response.json(buildEphemeralMessage("Failed to remove the timed role."));
    }

    return Response.json(
      buildEphemeralMessage(`Removed <@&${invocation.roleId}> from <@${invocation.userId}>.`),
    );
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "add") {
    if (!features.blocklist) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const normalizedEmoji = normalizeEmoji(invocation.emoji);
    if (!normalizedEmoji) {
      return Response.json(buildEphemeralMessage("Invalid emoji."));
    }

    try {
      const result = await blocklistService.addEmoji(interaction.guild_id, normalizedEmoji, actor);
      if (result.alreadyBlocked) {
        return Response.json(
          buildEphemeralMessage(`${invocation.emoji} is already blocked in this server.`),
        );
      }
      return Response.json(buildEphemeralMessage(`Blocked ${invocation.emoji} in this server.`));
    } catch (error) {
      console.error("Failed to update blocklist", error);
      return Response.json(buildEphemeralMessage("Failed to update the server blocklist."));
    }
  }

  if (invocation.commandName === "blocklist" && invocation.subcommandName === "remove") {
    if (!features.blocklist) {
      return Response.json(buildEphemeralMessage("This feature is currently disabled."));
    }
    const normalizedEmoji = normalizeEmoji(invocation.emoji);
    if (!normalizedEmoji) {
      return Response.json(buildEphemeralMessage("Invalid emoji."));
    }

    try {
      const result = await blocklistService.removeEmoji(
        interaction.guild_id,
        normalizedEmoji,
        actor,
      );
      if (!result.wasBlocked) {
        return Response.json(
          buildEphemeralMessage(`${invocation.emoji} is not currently blocked in this server.`),
        );
      }
      return Response.json(buildEphemeralMessage(`Unblocked ${invocation.emoji} in this server.`));
    } catch (error) {
      console.error("Failed to update blocklist", error);
      return Response.json(buildEphemeralMessage("Failed to update the server blocklist."));
    }
  }

  return Response.json(buildEphemeralMessage("Unsupported command."));
}

function formatBoundedBulletList(title: string, emptyMessage: string, items: string[]): string {
  if (items.length === 0) {
    return emptyMessage;
  }

  const lines = [title];

  for (let index = 0; index < items.length; index += 1) {
    const line = `- ${items[index]}`;
    const remainingAfterLine = items.length - index - 1;

    if (remainingAfterLine === 0) {
      return [...lines, line].join("\n");
    }

    const contentWithLine = [...lines, line].join("\n");
    const summaryLine = `...and ${remainingAfterLine} more.`;

    if (`${contentWithLine}\n${summaryLine}`.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
      lines.push(line);
      continue;
    }

    let omittedCount = items.length - index;
    while (lines.length > 1) {
      const truncatedContent = [...lines, `...and ${omittedCount} more.`].join("\n");
      if (truncatedContent.length <= DISCORD_MESSAGE_CONTENT_LIMIT) {
        return truncatedContent;
      }

      lines.pop();
      omittedCount += 1;
    }

    return `${title}\n...and ${items.length} more.`;
  }

  return lines.join("\n");
}
