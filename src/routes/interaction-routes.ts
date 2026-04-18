import type { GatewayController, RuntimeStore } from "../runtime/contracts";
import { handleInteractionRequest } from "../runtime/app";

export interface InteractionRouteOptions {
  discordPublicKey: string;
  discordBotToken: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  store: RuntimeStore;
  gateway: GatewayController;
}

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

export function createInteractionRoutes(options: InteractionRouteOptions): RouteHandler {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/interactions") {
      return handleInteractionRequest(request, options);
    }

    return null;
  };
}
