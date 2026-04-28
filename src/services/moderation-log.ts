import type { CreateChannelMessageInput } from "../discord/messages";
import { formatTimedRoleExpiry } from "../timed-roles";

export interface GuildNotificationChannelStore {
  readGuildNotificationChannel(guildId: string): Promise<string | null>;
  upsertGuildNotificationChannel(body: {
    guildId: string;
    notificationChannelId: string | null;
  }): Promise<void>;
}

export interface ModerationActionActor {
  label: string;
  userId?: string;
}

export type ChannelMessageSender = (
  channelId: string,
  body: CreateChannelMessageInput
) => Promise<void>;

export function buildBlocklistUpdateMessage(input: {
  action: "add" | "remove";
  emoji: string;
  actor?: ModerationActionActor;
}): CreateChannelMessageInput {
  return {
    content: `🧱 Blocklist update by ${formatActor(input.actor)}: ${input.action === "add" ? "blocked" : "unblocked"} ${input.emoji}.`,
    allowed_mentions: { parse: [] },
  };
}

export function buildTimedRoleUpdateMessage(input:
  | {
      action: "add";
      actor?: ModerationActionActor;
      userId: string;
      roleId: string;
      durationInput: string;
      expiresAtMs: number;
    }
  | {
      action: "remove";
      actor?: ModerationActionActor;
      userId: string;
      roleId: string;
    }
  | {
      action: "expire";
      userId: string;
      roleId: string;
    }
): CreateChannelMessageInput {
  if (input.action === "add") {
    return {
      content:
        `⏱ Timed role update by ${formatActor(input.actor)}: assigned <@&${input.roleId}> to <@${input.userId}> ` +
        `for ${input.durationInput} (${formatTimedRoleExpiry(input.expiresAtMs)}).`,
      allowed_mentions: { parse: [] },
    };
  }

  if (input.action === "remove") {
    return {
      content: `⏱ Timed role update by ${formatActor(input.actor)}: removed <@&${input.roleId}> from <@${input.userId}>.`,
      allowed_mentions: { parse: [] },
    };
  }

  return {
    content: `⏱ Timed role expired automatically: removed <@&${input.roleId}> from <@${input.userId}>.`,
    allowed_mentions: { parse: [] },
  };
}

export async function postGuildModerationUpdate(
  store: Partial<GuildNotificationChannelStore>,
  sendChannelMessage: ChannelMessageSender | undefined,
  guildId: string,
  body: CreateChannelMessageInput
): Promise<void> {
  if (
    typeof store.readGuildNotificationChannel !== "function" ||
    !sendChannelMessage
  ) {
    return;
  }

  try {
    const notificationChannelId = await store.readGuildNotificationChannel(guildId);

    if (!notificationChannelId) {
      return;
    }

    await sendChannelMessage(notificationChannelId, body);
  } catch (error) {
    console.error("Failed to post moderation update", error);
  }
}

function formatActor(actor?: ModerationActionActor): string {
  if (actor?.userId) {
    return `<@${actor.userId}>`;
  }

  return actor?.label ?? "a server admin";
}