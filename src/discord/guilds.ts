import { DISCORD_API, discordGetJson } from "./client";

export interface DiscordChannelResource {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  position: number | null;
  permission_overwrites?: DiscordPermissionOverwrite[];
}

export interface DiscordRoleResource {
  id: string;
  name: string;
  permissions: string;
  position: number;
}

export interface DiscordPermissionOverwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

export interface DiscordGuildMemberResource {
  user?: {
    id: string;
  };
  roles: string[];
}

export interface GuildTicketResources {
  channels: DiscordChannelResource[];
  roles: DiscordRoleResource[];
}

export async function listBotGuilds(
  botToken: string
): Promise<Array<{ guildId: string; name: string }>> {
  const guilds = await discordGetJson<Array<{ id: string; name: string }>>(
    `${DISCORD_API}/users/@me/guilds`,
    botToken
  );

  return guilds.map(({ id, name }) => ({ guildId: id, name }));
}

export interface DiscordGuildEmojiResource {
  id: string | null;
  name: string | null;
  animated?: boolean;
  available?: boolean;
}

export async function listGuildTicketResources(
  guildId: string,
  botToken: string
): Promise<GuildTicketResources> {
  const [channels, roles] = await Promise.all([
    discordGetJson<DiscordChannelResource[]>(`${DISCORD_API}/guilds/${guildId}/channels`, botToken),
    discordGetJson<DiscordRoleResource[]>(`${DISCORD_API}/guilds/${guildId}/roles`, botToken),
  ]);

  return {
    channels,
    roles,
  };
}

export async function listGuildEmojis(
  guildId: string,
  botToken: string
): Promise<DiscordGuildEmojiResource[]> {
  return discordGetJson<DiscordGuildEmojiResource[]>(
    `${DISCORD_API}/guilds/${guildId}/emojis`,
    botToken
  );
}

export async function getGuildPermissionResources(
  guildId: string,
  botUserId: string,
  botToken: string
): Promise<{
  channels: DiscordChannelResource[];
  roles: DiscordRoleResource[];
  member: DiscordGuildMemberResource;
}> {
  const [channels, roles, member] = await Promise.all([
    discordGetJson<DiscordChannelResource[]>(`${DISCORD_API}/guilds/${guildId}/channels`, botToken),
    discordGetJson<DiscordRoleResource[]>(`${DISCORD_API}/guilds/${guildId}/roles`, botToken),
    discordGetJson<DiscordGuildMemberResource>(`${DISCORD_API}/guilds/${guildId}/members/${botUserId}`, botToken),
  ]);

  return {
    channels,
    roles,
    member,
  };
}
