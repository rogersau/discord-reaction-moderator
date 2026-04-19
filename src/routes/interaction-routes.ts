import type { GatewayController, RuntimeStore } from "../runtime/contracts";
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
  store: RuntimeStore;
  gateway: GatewayController;
  services: InteractionRouteServices;
  handleInteractionRequest: (request: Request, options: Pick<InteractionRouteOptions, "discordPublicKey" | "discordBotToken" | "verifyDiscordRequest" | "store" | "gateway" | "services">) => Promise<Response>;
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
