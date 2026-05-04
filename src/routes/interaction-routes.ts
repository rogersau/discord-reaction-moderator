import type { GatewayController, TicketTranscriptBlobStore } from "../runtime/contracts";
import type { RuntimeStores } from "../runtime/app-types";
import type { FeatureFlags } from "../runtime/features";
import type { TimedRoleService } from "../services/timed-role-service";
import type { BlocklistService } from "../services/blocklist-service";

export interface InteractionRouteServices {
  timedRoleService: TimedRoleService;
  blocklistService: BlocklistService;
}

export interface InteractionRouteOptions {
  discordPublicKey: string;
  discordBotToken: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  stores: RuntimeStores;
  gateway: GatewayController;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
  services: InteractionRouteServices;
  features?: FeatureFlags;
  handleInteractionRequest: (
    request: Request,
    options: Pick<
      InteractionRouteOptions,
      | "discordPublicKey"
      | "discordBotToken"
      | "verifyDiscordRequest"
      | "stores"
      | "gateway"
      | "ticketTranscriptBlobs"
      | "services"
      | "features"
    >,
  ) => Promise<Response>;
}

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

export function createInteractionRoutes(options: InteractionRouteOptions): RouteHandler {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/interactions") {
      return options.handleInteractionRequest(request, options);
    }

    return null;
  };
}
