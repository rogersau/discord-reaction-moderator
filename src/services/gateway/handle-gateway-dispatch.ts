import { shouldHandleDispatch } from "../../gateway";
import type { DiscordReaction } from "../../types";

export interface DiscordGuildMemberAdd {
  guild_id?: string;
  user?: {
    id?: string;
  };
}

export async function handleGatewayDispatch(
  payload: { op: number; t?: string | null; d?: unknown },
  moderateReactionAdd: (reaction: DiscordReaction | null) => Promise<void>,
  handleGuildMemberAdd?: (member: DiscordGuildMemberAdd | null) => Promise<void>,
): Promise<void> {
  if (!shouldHandleDispatch({ op: payload.op, t: payload.t ?? null })) {
    return;
  }

  if (payload.t === "MESSAGE_REACTION_ADD") {
    await moderateReactionAdd(payload.d as DiscordReaction | null);
    return;
  }

  if (payload.t === "GUILD_MEMBER_ADD" && handleGuildMemberAdd) {
    await handleGuildMemberAdd(payload.d as DiscordGuildMemberAdd | null);
  }
}
