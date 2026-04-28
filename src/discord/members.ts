import { DISCORD_API, DiscordApiError } from "./client";

export async function addGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  await mutateGuildMemberRole("PUT", guildId, userId, roleId, botToken);
}

export async function removeGuildMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  await mutateGuildMemberRole("DELETE", guildId, userId, roleId, botToken);
}

async function mutateGuildMemberRole(
  method: "PUT" | "DELETE",
  guildId: string,
  userId: string,
  roleId: string,
  botToken: string
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method,
      headers: {
        Authorization: `Bot ${botToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(
      `Discord API error: ${response.status} ${error}`,
      response.status,
      error
    );
  }
}
