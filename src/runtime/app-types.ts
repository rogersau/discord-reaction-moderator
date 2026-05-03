import type {
  GatewayController,
  TicketTranscriptBlobStore,
  BlocklistStore,
  AppConfigStore,
  TimedRoleStore,
  TicketStore,
  MarketplaceStore,
} from "./contracts";

export interface DiscordInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    permissions?: string;
    roles?: unknown;
    user?: {
      id?: string;
      username?: string;
      global_name?: string | null;
    };
  };
  user?: {
    id?: string;
    username?: string;
    global_name?: string | null;
  };
  data?: unknown;
}

export interface RuntimeStores {
  blocklist: BlocklistStore;
  appConfig: AppConfigStore;
  timedRoles: TimedRoleStore;
  tickets: TicketStore;
  marketplace: MarketplaceStore;
}

export interface RuntimeAppOptions {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminSessionSecret?: string;
  adminUiPassword?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  stores: RuntimeStores;
  gateway: GatewayController;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}
