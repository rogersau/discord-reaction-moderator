import type { TimedRoleStore } from "../runtime/contracts";
import type { TimedRoleAssignment } from "../types";
import { assignTimedRole as assignTimedRoleWorkflow } from "./timed-roles/assign-timed-role";
import { removeTimedRole as removeTimedRoleWorkflow } from "./timed-roles/remove-timed-role";
import { listTimedRoles as listTimedRolesWorkflow } from "./timed-roles/list-timed-roles";
import {
  buildTimedRoleUpdateMessage,
  postGuildModerationUpdate,
  type ChannelMessageSender,
  type GuildNotificationChannelStore,
  type ModerationActionActor,
} from "./moderation-log";

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
    private readonly removeRoleFromMember?: (guildId: string, userId: string, roleId: string) => Promise<void>,
    private readonly notificationStore?: Partial<GuildNotificationChannelStore>,
    private readonly sendChannelMessage?: ChannelMessageSender
  ) {}

  async assignTimedRole(
    assignment: TimedRoleAssignment,
    actor?: ModerationActionActor
  ): Promise<void> {
    if (!this.addRoleToMember) {
      await this.store.upsertTimedRole(assignment);
      await this.postUpdate(
        assignment.guildId,
        buildTimedRoleUpdateMessage({
          action: "add",
          actor,
          userId: assignment.userId,
          roleId: assignment.roleId,
          durationInput: assignment.durationInput,
          expiresAtMs: assignment.expiresAtMs,
        })
      );
      return;
    }

    await assignTimedRoleWorkflow(this.store, this.addRoleToMember, assignment);
    await this.postUpdate(
      assignment.guildId,
      buildTimedRoleUpdateMessage({
        action: "add",
        actor,
        userId: assignment.userId,
        roleId: assignment.roleId,
        durationInput: assignment.durationInput,
        expiresAtMs: assignment.expiresAtMs,
      })
    );
  }

  async removeTimedRole(
    key: TimedRoleKey,
    actor?: ModerationActionActor
  ): Promise<void> {
    await removeTimedRoleWorkflow(this.store, this.removeRoleFromMember, key);
    await this.postUpdate(
      key.guildId,
      buildTimedRoleUpdateMessage({
        action: "remove",
        actor,
        userId: key.userId,
        roleId: key.roleId,
      })
    );
  }

  async listTimedRoles(guildId: string): Promise<TimedRoleAssignment[]> {
    return listTimedRolesWorkflow(this.store, guildId);
  }

  private async postUpdate(
    guildId: string,
    body: ReturnType<typeof buildTimedRoleUpdateMessage>
  ): Promise<void> {
    await postGuildModerationUpdate(
      this.notificationStore ?? {},
      this.sendChannelMessage,
      guildId,
      body
    );
  }
}
