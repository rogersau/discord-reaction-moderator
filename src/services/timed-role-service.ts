import type { TimedRoleStore } from "../runtime/contracts";
import type { TimedRoleAssignment } from "../types";
import { assignTimedRole as assignTimedRoleWorkflow } from "./timed-roles/assign-timed-role";
import { removeTimedRole as removeTimedRoleWorkflow } from "./timed-roles/remove-timed-role";
import { listTimedRoles as listTimedRolesWorkflow } from "./timed-roles/list-timed-roles";

export interface TimedRoleKey {
  guildId: string;
  userId: string;
  roleId: string;
}

export class TimedRoleService {
  constructor(
    private readonly store: TimedRoleStore,
    _botToken: string,
    private readonly addRoleToMember?: (guildId: string, userId: string, roleId: string) => Promise<void>,
    private readonly removeRoleFromMember?: (guildId: string, userId: string, roleId: string) => Promise<void>
  ) {}

  async assignTimedRole(assignment: TimedRoleAssignment): Promise<void> {
    if (!this.addRoleToMember) {
      await this.store.upsertTimedRole(assignment);
      return;
    }

    await assignTimedRoleWorkflow(this.store, this.addRoleToMember, assignment);
  }

  async removeTimedRole(key: TimedRoleKey): Promise<void> {
    await removeTimedRoleWorkflow(this.store, this.removeRoleFromMember, key);
  }

  async listTimedRoles(guildId: string): Promise<TimedRoleAssignment[]> {
    return listTimedRolesWorkflow(this.store, guildId);
  }
}
