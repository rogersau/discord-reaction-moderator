export const ADMINISTRATOR_PERMISSION = 1n << 3n;
export const MANAGE_GUILD_PERMISSION = 1n << 5n;

export function hasGuildAdminPermission(permissions: string): boolean {
  try {
    const perms = BigInt(permissions);
    return (perms & (ADMINISTRATOR_PERMISSION | MANAGE_GUILD_PERMISSION)) !== 0n;
  } catch {
    return false;
  }
}

import { SLASH_COMMAND_DEFINITIONS } from "./discord-commands";

type CommandInvocation =
  | { commandName: "blocklist"; subcommandName: "list" }
  | { commandName: "blocklist"; subcommandName: "add" | "remove"; emoji: string }
  | { commandName: "timedrole"; subcommandName: "list" }
  | {
      commandName: "timedrole";
      subcommandName: "add";
      userId: string;
      roleId: string;
      duration: string;
    }
  | {
      commandName: "timedrole";
      subcommandName: "remove";
      userId: string;
      roleId: string;
    };

function getStringOptionValue(options: any[], name: string): string | null {
  const value = options.find((option: any) => option.name === name)?.value;
  return typeof value === "string" ? value : null;
}

export function extractCommandInvocation(invocation: any): any {
  const data = invocation?.data;
  if (!data || typeof data.name !== "string") return null;

  const cmdDef = SLASH_COMMAND_DEFINITIONS.find((d) => d.name === data.name);
  if (!cmdDef) return null;

  const options = Array.isArray(data.options) ? data.options : [];
  const sub = options[0];
  if (!sub || sub.type !== 1) return null;

  const subDef = (cmdDef.options || []).find(
    (o: any) => o.name === sub.name && o.type === sub.type
  );
  if (!subDef) return null;

  if (sub.name === "list") {
    if (data.name === "blocklist") {
      return { commandName: "blocklist", subcommandName: "list" };
    }

    if (data.name === "timedrole") {
      return { commandName: "timedrole", subcommandName: "list" } as CommandInvocation;
    }

    return null;
  }

  const subOptions = Array.isArray(sub.options) ? sub.options : [];

  if (data.name === "blocklist") {
    const emojiDef = (subDef.options || []).find((o: any) => o.name === "emoji" && o.type === 3);
    if (!emojiDef) return null;

    const emoji = getStringOptionValue(subOptions, "emoji");
    if (!emoji || (sub.name !== "add" && sub.name !== "remove")) return null;

    return { commandName: "blocklist", subcommandName: sub.name, emoji };
  }

  const userDef = (subDef.options || []).find((o: any) => o.name === "user" && o.type === 6);
  const roleDef = (subDef.options || []).find((o: any) => o.name === "role" && o.type === 8);
  if (!userDef || !roleDef) return null;

  const userId = getStringOptionValue(subOptions, "user");
  const roleId = getStringOptionValue(subOptions, "role");
  if (!userId || !roleId) return null;

  if (sub.name === "remove") {
    return { commandName: "timedrole", subcommandName: "remove", userId, roleId } as CommandInvocation;
  }

  const durationDef = (subDef.options || []).find((o: any) => o.name === "duration" && o.type === 3);
  if (!durationDef || sub.name !== "add") return null;

  const duration = getStringOptionValue(subOptions, "duration");
  if (!duration) return null;

  return { commandName: "timedrole", subcommandName: "add", userId, roleId, duration } as CommandInvocation;
}

export function buildEphemeralMessage(content: string) {
  return { type: 4, data: { content, flags: 64 } };
}
