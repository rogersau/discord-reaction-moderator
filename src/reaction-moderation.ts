import { getBlocklistFromStore, isEmojiBlocked, normalizeEmoji } from "./blocklist";
import { deleteReaction } from "./discord";
import type { Env } from "./env";
import type { DiscordReaction } from "./types";

type ModerationEnv = Pick<Env, "DISCORD_BOT_TOKEN" | "MODERATION_STORE_DO">;

export async function moderateReactionAdd(
  reaction: DiscordReaction | null,
  env: ModerationEnv,
): Promise<void> {
  if (!reaction) {
    return;
  }

  const emojiName = normalizeEmoji(reaction.emoji.name);
  let emojiId: string;

  if (reaction.emoji.id && reaction.emoji.name) {
    emojiId = `${reaction.emoji.name}:${reaction.emoji.id}`;
  } else if (emojiName) {
    emojiId = emojiName;
  } else {
    return;
  }

  let blocklist;
  try {
    blocklist = await getBlocklistFromStore(() =>
      getModerationStoreStub(env).fetch("https://moderation-store/config"),
    );
  } catch (error) {
    console.error("Failed to load moderation config", error);
    return;
  }

  if (reaction.user_id === blocklist.botUserId) {
    return;
  }

  if (!isEmojiBlocked(emojiId, blocklist, reaction.guild_id)) {
    return;
  }

  try {
    await deleteReaction(
      reaction.channel_id,
      reaction.message_id,
      reaction.emoji,
      reaction.user_id,
      env.DISCORD_BOT_TOKEN,
    );

    console.log(
      `Removed reaction ${emojiId} from message ${reaction.message_id} in channel ${reaction.channel_id}`,
    );
  } catch (error) {
    console.error("Failed to remove reaction:", error);
  }
}

export function getModerationStoreStub(env: Pick<Env, "MODERATION_STORE_DO">): DurableObjectStub {
  const storeId = env.MODERATION_STORE_DO.idFromName("moderation-store");
  return env.MODERATION_STORE_DO.get(storeId);
}
