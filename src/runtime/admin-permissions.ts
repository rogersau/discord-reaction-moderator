import {
  getGuildPermissionResources,
  type DiscordChannelResource,
  type DiscordGuildMemberResource,
  type DiscordRoleResource,
} from "../discord";
import type { TicketPanelConfig, TimedRoleAssignment } from "../types";
import type { AdminPermissionCheck } from "./admin-types";

const ADMINISTRATOR_PERMISSION = 1n << 3n;
const MANAGE_CHANNELS_PERMISSION = 1n << 4n;
const VIEW_CHANNEL_PERMISSION = 1n << 10n;
const SEND_MESSAGES_PERMISSION = 1n << 11n;
const MANAGE_MESSAGES_PERMISSION = 1n << 13n;
const MANAGE_ROLES_PERMISSION = 1n << 28n;

export interface GuildPermissionContext {
  guildId: string;
  botUserId: string;
  channels: DiscordChannelResource[];
  roles: DiscordRoleResource[];
  member: DiscordGuildMemberResource;
}

export async function loadGuildPermissionContext(
  guildId: string,
  botUserId: string,
  botToken: string,
): Promise<GuildPermissionContext> {
  const resources = await getGuildPermissionResources(guildId, botUserId, botToken);

  return {
    guildId,
    botUserId,
    channels: resources.channels,
    roles: resources.roles,
    member: resources.member,
  };
}

export function buildBlocklistPermissionChecks(
  context: GuildPermissionContext,
): AdminPermissionCheck[] {
  const textChannels = context.channels.filter(
    (channel) => channel.type === 0 || channel.type === 5,
  );

  if (textChannels.length === 0) {
    return [
      {
        label: "Visible text channels",
        status: "warning",
        detail: "This server has no text channels to verify for reaction cleanup.",
      },
    ];
  }

  const visibleChannels = textChannels.filter((channel) =>
    hasPermission(getChannelPermissions(context, channel), VIEW_CHANNEL_PERMISSION),
  );
  const manageableChannels = visibleChannels.filter((channel) =>
    hasPermission(getChannelPermissions(context, channel), MANAGE_MESSAGES_PERMISSION),
  );

  return [
    {
      label: "Visible text channels",
      status: visibleChannels.length > 0 ? "ok" : "error",
      detail: `The bot can view ${visibleChannels.length} of ${textChannels.length} text channels in this server.`,
    },
    {
      label: "Manage Messages in text channels",
      status:
        visibleChannels.length > 0 && manageableChannels.length === visibleChannels.length
          ? "ok"
          : "warning",
      detail:
        visibleChannels.length === 0
          ? "Manage Messages cannot be verified until the bot can view at least one text channel."
          : manageableChannels.length === visibleChannels.length
            ? `Manage Messages is available in all ${visibleChannels.length} visible text channels.`
            : `Manage Messages is missing in ${visibleChannels.length - manageableChannels.length} of ${visibleChannels.length} visible text channels, so reaction cleanup can fail there.`,
    },
  ];
}

export function buildTimedRolePermissionChecks(
  context: GuildPermissionContext,
  timedRoles: TimedRoleAssignment[],
): AdminPermissionCheck[] {
  const basePermissions = getBaseGuildPermissions(context);
  const highestRole = getHighestBotRole(context);

  const checks: AdminPermissionCheck[] = [
    {
      label: "Manage Roles",
      status: hasPermission(basePermissions, MANAGE_ROLES_PERMISSION) ? "ok" : "error",
      detail: hasPermission(basePermissions, MANAGE_ROLES_PERMISSION)
        ? "Manage Roles is enabled for the bot at the server level."
        : "Manage Roles is missing for the bot at the server level.",
    },
  ];

  if (timedRoles.length === 0) {
    const manageableRoles = highestRole
      ? context.roles.filter(
          (role) => role.id !== context.guildId && role.position < highestRole.position,
        )
      : [];

    checks.push({
      label: "Role hierarchy boundary",
      status: highestRole && manageableRoles.length > 0 ? "ok" : "warning",
      detail: highestRole
        ? `The bot's highest role is ${highestRole.name}; it can manage ${manageableRoles.length} role${manageableRoles.length === 1 ? "" : "s"} below it.`
        : "The bot has no server role above @everyone, so role hierarchy checks are limited.",
    });

    return checks;
  }

  const roleMap = new Map(context.roles.map((role) => [role.id, role] as const));
  const trackedTargetIds = [...new Set(timedRoles.map((assignment) => assignment.roleId))];
  const blockedTargets = trackedTargetIds.filter((roleId) => {
    const role = roleMap.get(roleId);
    if (!role || !highestRole) {
      return true;
    }
    return role.position >= highestRole.position;
  });

  checks.push({
    label: "Timed role targets below the bot",
    status: blockedTargets.length === 0 ? "ok" : "error",
    detail:
      blockedTargets.length === 0
        ? `All ${trackedTargetIds.length} tracked timed role target${trackedTargetIds.length === 1 ? "" : "s"} are below the bot's highest role${highestRole ? ` (${highestRole.name})` : ""}.`
        : `${blockedTargets.length} tracked timed role${blockedTargets.length === 1 ? "" : "s"} ${blockedTargets.length === 1 ? "is" : "are"} at or above the bot's highest role.`,
  });

  return checks;
}

export function buildTicketPermissionChecks(
  context: GuildPermissionContext,
  panel: TicketPanelConfig | null,
): AdminPermissionCheck[] {
  if (!panel) {
    return [];
  }

  const basePermissions = getBaseGuildPermissions(context);
  const roleMap = new Map(context.roles.map((role) => [role.id, role] as const));
  const channelMap = new Map(context.channels.map((channel) => [channel.id, channel] as const));
  const checks: AdminPermissionCheck[] = [
    {
      label: "Manage Channels",
      status: hasPermission(basePermissions, MANAGE_CHANNELS_PERMISSION) ? "ok" : "error",
      detail: hasPermission(basePermissions, MANAGE_CHANNELS_PERMISSION)
        ? "Manage Channels is enabled for creating ticket channels."
        : "Manage Channels is missing, so new ticket channels cannot be created.",
    },
    buildConfiguredChannelCheck(context, channelMap, panel.panelChannelId, "Panel channel access"),
    buildConfiguredChannelCheck(
      context,
      channelMap,
      panel.transcriptChannelId,
      "Transcript channel access",
    ),
  ];

  if (panel.categoryChannelId) {
    const category = channelMap.get(panel.categoryChannelId);
    checks.push({
      label: "Ticket category visibility",
      status:
        category && hasPermission(getChannelPermissions(context, category), VIEW_CHANNEL_PERMISSION)
          ? "ok"
          : "error",
      detail: !category
        ? "The configured ticket category no longer exists in Discord."
        : hasPermission(getChannelPermissions(context, category), VIEW_CHANNEL_PERMISSION)
          ? "The bot can view the configured ticket category."
          : "The bot cannot view the configured ticket category.",
    });
  }

  const supportRoleIds = [
    ...new Set(panel.ticketTypes.map((ticketType) => ticketType.supportRoleId).filter(Boolean)),
  ];
  const missingSupportRoles = supportRoleIds.filter((roleId) => !roleMap.has(roleId));
  checks.push({
    label: "Support roles",
    status: missingSupportRoles.length === 0 ? "ok" : "error",
    detail:
      missingSupportRoles.length === 0
        ? `All ${supportRoleIds.length} configured support role${supportRoleIds.length === 1 ? "" : "s"} are present in the server.`
        : `${missingSupportRoles.length} configured support role${missingSupportRoles.length === 1 ? "" : "s"} could not be found in Discord.`,
  });

  return checks;
}

function buildConfiguredChannelCheck(
  context: GuildPermissionContext,
  channelMap: Map<string, DiscordChannelResource>,
  channelId: string,
  label: string,
): AdminPermissionCheck {
  const channel = channelMap.get(channelId);
  if (!channel) {
    return {
      label,
      status: "error",
      detail: "The configured Discord channel no longer exists.",
    };
  }

  const permissions = getChannelPermissions(context, channel);
  const hasChannelAccess =
    hasPermission(permissions, VIEW_CHANNEL_PERMISSION) &&
    hasPermission(permissions, SEND_MESSAGES_PERMISSION);

  return {
    label,
    status: hasChannelAccess ? "ok" : "error",
    detail: hasChannelAccess
      ? "The bot can view and send messages in the configured channel."
      : "The bot cannot fully access the configured channel for ticket automation.",
  };
}

function getBaseGuildPermissions(context: GuildPermissionContext): bigint {
  const roleMap = new Map(context.roles.map((role) => [role.id, role] as const));
  let permissions = parsePermissionBits(roleMap.get(context.guildId)?.permissions);

  for (const roleId of context.member.roles) {
    permissions |= parsePermissionBits(roleMap.get(roleId)?.permissions);
  }

  return permissions;
}

function getChannelPermissions(
  context: GuildPermissionContext,
  channel: DiscordChannelResource,
): bigint {
  let permissions = getBaseGuildPermissions(context);
  if ((permissions & ADMINISTRATOR_PERMISSION) !== 0n) {
    return permissions;
  }

  const overwrites = channel.permission_overwrites ?? [];
  const everyoneOverwrite = overwrites.find((overwrite) => overwrite.id === context.guildId);
  if (everyoneOverwrite) {
    permissions = applyOverwrite(permissions, everyoneOverwrite.allow, everyoneOverwrite.deny);
  }

  let roleAllow = 0n;
  let roleDeny = 0n;
  for (const overwrite of overwrites) {
    if (overwrite.type !== 0 || !context.member.roles.includes(overwrite.id)) {
      continue;
    }
    roleAllow |= parsePermissionBits(overwrite.allow);
    roleDeny |= parsePermissionBits(overwrite.deny);
  }
  permissions &= ~roleDeny;
  permissions |= roleAllow;

  const memberOverwrite = overwrites.find(
    (overwrite) => overwrite.type === 1 && overwrite.id === context.botUserId,
  );
  if (memberOverwrite) {
    permissions = applyOverwrite(permissions, memberOverwrite.allow, memberOverwrite.deny);
  }

  return permissions;
}

function getHighestBotRole(context: GuildPermissionContext): DiscordRoleResource | null {
  const roleMap = new Map(context.roles.map((role) => [role.id, role] as const));
  let highestRole: DiscordRoleResource | null = null;

  for (const roleId of context.member.roles) {
    const role = roleMap.get(roleId);
    if (!role) {
      continue;
    }
    if (!highestRole || role.position > highestRole.position) {
      highestRole = role;
    }
  }

  return highestRole;
}

function hasPermission(permissions: bigint, flag: bigint): boolean {
  return (permissions & ADMINISTRATOR_PERMISSION) !== 0n || (permissions & flag) === flag;
}

function applyOverwrite(permissions: bigint, allow: string, deny: string): bigint {
  const denied = parsePermissionBits(deny);
  const allowed = parsePermissionBits(allow);
  return (permissions & ~denied) | allowed;
}

function parsePermissionBits(value: string | undefined): bigint {
  if (!value) {
    return 0n;
  }

  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}
