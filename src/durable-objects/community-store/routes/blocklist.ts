import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  CommunityStoreInputError,
  parseAppConfigMutation,
  parseGuildEmojiMutation,
  parseGuildNotificationChannelMutation,
  asRequiredSearchParam,
} from "../request-parsers";
import * as blocklistStore from "../blocklist-store";
import * as appConfigStore from "../app-config-store";

export async function routeBlocklist(
  sql: DurableObjectStorage["sql"],
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/config") {
    try {
      return Response.json(blocklistStore.readConfig(sql));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/guild-emoji") {
    try {
      const body = parseGuildEmojiMutation(await request.json());
      return Response.json(blocklistStore.applyGuildEmojiMutation(sql, body));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/guild-notification-channel") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      return Response.json({
        notificationChannelId: blocklistStore.readGuildNotificationChannel(sql, guildId),
      });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/guild-notification-channel") {
    try {
      const body = parseGuildNotificationChannelMutation(await request.json());
      blocklistStore.upsertGuildNotificationChannel(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/app-config") {
    try {
      const body = parseAppConfigMutation(await request.json());
      return Response.json(appConfigStore.upsertAppConfig(sql, body));
    } catch (error) {
      return errorResponse(error);
    }
  }

  return null;
}

function errorResponse(error: unknown): Response {
  if (error instanceof SyntaxError || error instanceof CommunityStoreInputError) {
    return Response.json({ error: error.message || "Invalid JSON body" }, { status: 400 });
  }
  console.error("Community store request failed", error);
  return Response.json({ error: "Internal Server Error" }, { status: 500 });
}
