import { getBlocklistFromStore, isEmojiBlocked, normalizeEmoji } from "../../blocklist";
import { deleteReaction } from "../../discord";
import type { Env } from "../../env";
import type { DiscordReaction } from "../../types";
import { getCommunityStoreStub } from "../../runtime/community-store-stub";

type BlocklistEnv = Pick<Env, "DISCORD_BOT_TOKEN" | "COMMUNITY_STORE_DO">;

export async function moderateReactionAdd(
  reaction: DiscordReaction | null,
  env: BlocklistEnv,
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
      getCommunityStoreStub(env).fetch("https://community-store/config"),
    );
  } catch (error) {
    console.error("Failed to load blocklist config", error);
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
