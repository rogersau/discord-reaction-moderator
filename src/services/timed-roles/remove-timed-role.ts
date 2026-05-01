import type { TimedRoleStore } from "../../runtime/contracts/timed-role-store";

export interface TimedRoleKey {
  guildId: string;
  userId: string;
  roleId: string;
}

export async function removeTimedRole(
  store: Pick<TimedRoleStore, "deleteTimedRole">,
  removeRoleFromMember:
    | ((guildId: string, userId: string, roleId: string) => Promise<void>)
    | undefined,
  key: TimedRoleKey,
): Promise<void> {
  if (removeRoleFromMember) {
    await removeRoleFromMember(key.guildId, key.userId, key.roleId);
  }

  await store.deleteTimedRole(key);
}
