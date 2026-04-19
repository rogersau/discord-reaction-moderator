import type { RuntimeStore } from "../runtime/contracts";
import type { TimedRoleAssignment } from "../types";

export interface TimedRoleKey {
  guildId: string;
  userId: string;
  roleId: string;
}

export class TimedRoleService {
  constructor(
    private readonly store: RuntimeStore,
    _botToken: string,
    private readonly addRoleToMember?: (guildId: string, userId: string, roleId: string) => Promise<void>,
    private readonly removeRoleFromMember?: (guildId: string, userId: string, roleId: string) => Promise<void>
  ) {}

  async assignTimedRole(assignment: TimedRoleAssignment): Promise<void> {
    // Persist first
    await this.store.upsertTimedRole(assignment);

    try {
      // Then assign Discord role
      if (this.addRoleToMember) {
        await this.addRoleToMember(assignment.guildId, assignment.userId, assignment.roleId);
      }
    } catch (error) {
      // Rollback on failure
      await this.store.deleteTimedRole({
        guildId: assignment.guildId,
        userId: assignment.userId,
        roleId: assignment.roleId,
      });
      throw error;
    }
  }

  async removeTimedRole(key: TimedRoleKey): Promise<void> {
    // Remove from Discord first
    if (this.removeRoleFromMember) {
      await this.removeRoleFromMember(key.guildId, key.userId, key.roleId);
    }

    // Then delete from database
    await this.store.deleteTimedRole(key);
  }

  async listTimedRoles(guildId: string): Promise<TimedRoleAssignment[]> {
    return this.store.listTimedRolesByGuild(guildId);
  }
}
