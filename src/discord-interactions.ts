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

export function extractCommandInvocation(invocation: any):
  | { commandName: string; subcommandName: string; emoji: string }
  | null {
  const data = invocation?.data;
  if (!data || data.name !== "blocklist") return null;
  const options = Array.isArray(data.options) ? data.options : [];
  const sub = options[0];
  if (!sub || sub.type !== 1) return null;
  const emojiOpt = Array.isArray(sub.options)
    ? sub.options.find((o: any) => o.name === "emoji")
    : undefined;
  const emoji = emojiOpt?.value;
  if (!emoji) return null;
  return { commandName: "blocklist", subcommandName: sub.name, emoji };
}

export function buildEphemeralMessage(content: string) {
  return { type: 4, data: { content, flags: 64 } };
}
