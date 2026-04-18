import type { Env } from "../env";
import { assertValidDiscordPublicKey } from "../discord";
import { getModerationStoreStub } from "../reaction-moderation";
import { createCloudflareStoreClient } from "./cloudflare-store-client";
import { createCloudflareGatewayClient } from "./cloudflare-gateway-client";
import type { RuntimeStore, GatewayController } from "./contracts";

export interface RuntimeAppContext {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminUiPassword?: string;
  adminSessionSecret?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  store: RuntimeStore;
  gateway: GatewayController;
}

export function createCloudflareContext(env: Env): RuntimeAppContext {
  const gatewayStub = env.GATEWAY_SESSION_DO.get(env.GATEWAY_SESSION_DO.idFromName("gateway-session"));
  const storeStub = getModerationStoreStub(env);

  const storeClient = createCloudflareStoreClient(storeStub);
  const gatewayClient = createCloudflareGatewayClient(gatewayStub);

  const context: RuntimeAppContext = {
    discordPublicKey: assertValidDiscordPublicKey(env.DISCORD_PUBLIC_KEY),
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    adminUiPassword: env.ADMIN_UI_PASSWORD,
    adminSessionSecret: env.ADMIN_SESSION_SECRET,
    store: {
      readConfig: storeClient.readConfig,
      upsertAppConfig: storeClient.upsertAppConfig,
      applyGuildEmojiMutation: storeClient.applyGuildEmojiMutation,
      readTicketPanelConfig: storeClient.readTicketPanelConfig,
      upsertTicketPanelConfig: storeClient.upsertTicketPanelConfig,
      createTicketInstance: storeClient.createTicketInstance,
      deleteTicketInstance: storeClient.deleteTicketInstance,
      readOpenTicketByChannel: storeClient.readOpenTicketByChannel,
      closeTicketInstance: storeClient.closeTicketInstance,
      listTimedRoles: storeClient.listTimedRoles,
      listTimedRolesByGuild: storeClient.listTimedRolesByGuild,
      upsertTimedRole: storeClient.upsertTimedRole,
      deleteTimedRole: storeClient.deleteTimedRole,
      async listExpiredTimedRoles() {
        // Cloudflare: Durable Object alarms handle expiry automatically; polling not needed
        return [];
      },
      readGatewaySnapshot: storeClient.readGatewaySnapshot,
      writeGatewaySnapshot: storeClient.writeGatewaySnapshot,
    },
    gateway: {
      start: gatewayClient.start,
      status: gatewayClient.status,
    },
  };

  return context;
}
