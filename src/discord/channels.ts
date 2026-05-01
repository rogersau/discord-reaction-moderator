import { DISCORD_API, parseDiscordJson } from "./client";

export interface CreateTicketChannelInput {
  guildId: string;
  name: string;
  parentId: string | null;
  botUserId: string;
  openerUserId: string;
  supportRoleId: string;
}

export async function createTicketChannel(
  input: CreateTicketChannelInput,
  botToken: string,
): Promise<{ id: string }> {
  const response = await fetch(`${DISCORD_API}/guilds/${input.guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: input.name,
      type: 0,
      parent_id: input.parentId ?? undefined,
      permission_overwrites: [
        { id: input.guildId, type: 0, deny: "1024", allow: "0" },
        { id: input.botUserId, type: 1, allow: "1024", deny: "0" },
        { id: input.openerUserId, type: 1, allow: "1024", deny: "0" },
        { id: input.supportRoleId, type: 0, allow: "1024", deny: "0" },
      ],
    }),
  });

  return parseDiscordJson<{ id: string }>(response, "Failed to create ticket channel");
}
