import type { RuntimeStore, GatewayController } from "../runtime/contracts";
import type { BlocklistConfig, TimedRoleAssignment } from "../types";
import type { AdminPermissionCheck } from "../runtime/admin-types";

export interface AdminOverviewGuild {
  guildId: string;
  emojis: string[];
  timedRoles: TimedRoleAssignment[];
  permissionChecks: AdminPermissionCheck[];
}

export interface AdminOverviewData {
  gateway: unknown;
  guilds: AdminOverviewGuild[];
}

export class AdminOverviewService {
  constructor(
    private readonly store: RuntimeStore,
    private readonly gateway: GatewayController,
    private readonly buildOverviewGuilds: (
      config: BlocklistConfig,
      timedRoles: TimedRoleAssignment[]
    ) => Promise<AdminOverviewGuild[]>
  ) {}

  async getOverview(): Promise<AdminOverviewData> {
    const [gateway, config, timedRoles] = await Promise.all([
      this.gateway.status(),
      this.store.readConfig(),
      this.store.listTimedRoles(),
    ]);

    return {
      gateway,
      guilds: await this.buildOverviewGuilds(config, timedRoles),
    };
  }
}
