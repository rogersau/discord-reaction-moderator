import type { TimedRoleAssignment } from "../../types";
import type { TimedRoleStore } from "../../runtime/contracts/timed-role-store";

export async function listTimedRoles(
  store: Pick<TimedRoleStore, "listTimedRolesByGuild">,
  guildId: string,
): Promise<TimedRoleAssignment[]> {
  return store.listTimedRolesByGuild(guildId);
}
