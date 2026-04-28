import {
  addGuildMemberRole,
  createChannelMessage,
  removeGuildMemberRole,
  syncApplicationCommands,
} from "../discord";
import { createAdminRoutes } from "../routes/admin-routes";
import { createInteractionRoutes } from "../routes/interaction-routes";
import { createPublicRoutes } from "../routes/public-routes";
import { AdminOverviewService } from "../services/admin-overview-service";
import { BlocklistService } from "../services/blocklist-service";
import { GatewayService } from "../services/gateway-service";
import { TimedRoleService } from "../services/timed-role-service";
import { createAdminApiHandler, buildAdminOverviewGuilds } from "./admin-api";
import {
  getAdminLoginLocation,
  isAdminUiAuthorized,
  redirect,
  renderAdminShell,
  requireAdminSession,
} from "./admin-shell";
import type { RuntimeAppOptions } from "./app-types";
import { handleInteractionRequest } from "./interaction-handler";
import type { GuildNotificationChannelStore } from "../services/moderation-log";

export { escapeHtmlAttribute } from "./admin-shell";
export type { RuntimeAppOptions } from "./app-types";

export function createRuntimeApp(options: RuntimeAppOptions) {
  const gatewayService = new GatewayService(options.gateway, {
    discordApplicationId: options.discordApplicationId,
    syncApplicationCommands: options.discordApplicationId
      ? (appId) => syncApplicationCommands(appId, options.discordBotToken)
      : undefined,
  });

  const timedRoleService = new TimedRoleService(
    options.stores.timedRoles,
    options.discordBotToken,
    (guildId, userId, roleId) => addGuildMemberRole(guildId, userId, roleId, options.discordBotToken),
    (guildId, userId, roleId) => removeGuildMemberRole(guildId, userId, roleId, options.discordBotToken),
    options.stores.blocklist as Partial<GuildNotificationChannelStore>,
    (channelId, body) => createChannelMessage(channelId, body, options.discordBotToken).then(() => undefined)
  );

  const adminOverviewService = new AdminOverviewService(
    options.stores.blocklist,
    options.stores.timedRoles,
    options.gateway,
    (config, timedRoles) => buildAdminOverviewGuilds(config, timedRoles, options.discordBotToken)
  );

  const blocklistService = new BlocklistService(
    options.stores.blocklist,
    (channelId, body) => createChannelMessage(channelId, body, options.discordBotToken).then(() => undefined)
  );
  const handleAdminApiRequest = createAdminApiHandler({
    stores: options.stores,
    discordBotToken: options.discordBotToken,
  });

  const publicRoutes = createPublicRoutes({
    ticketTranscriptBlobs: options.ticketTranscriptBlobs,
  });
  const adminRoutes = createAdminRoutes({
    adminSessionSecret: options.adminSessionSecret,
    adminUiPassword: options.adminUiPassword,
    services: {
      gatewayService,
      adminOverviewService,
      blocklistService,
      timedRoleService,
    },
    handleAdminApiRequest,
    redirect,
    getAdminLoginLocation,
    renderAdminShell,
    isAdminUiAuthorized,
    requireAdminSession,
  });
  const interactionRoutes = createInteractionRoutes({
    discordPublicKey: options.discordPublicKey,
    discordBotToken: options.discordBotToken,
    verifyDiscordRequest: options.verifyDiscordRequest,
    stores: options.stores,
    gateway: options.gateway,
    ticketTranscriptBlobs: options.ticketTranscriptBlobs,
    services: {
      timedRoleService,
      blocklistService,
    },
    handleInteractionRequest,
  });

  return {
    async fetch(request: Request): Promise<Response> {
      const publicResponse = await publicRoutes(request);
      if (publicResponse) return publicResponse;

      const adminResponse = await adminRoutes(request);
      if (adminResponse) return adminResponse;

      const interactionResponse = await interactionRoutes(request);
      if (interactionResponse) return interactionResponse;

      return new Response("Not found", { status: 404 });
    },
    async bootstrap() {
      return gatewayService.bootstrap();
    },
  };
}