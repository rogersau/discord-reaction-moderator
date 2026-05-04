import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  CommunityStoreInputError,
  parseMarketplaceConfig,
  parseMarketplaceLog,
  parseMarketplacePost,
  parseMarketplacePostClose,
  parseMarketplacePostMessage,
  asRequiredSearchParam,
} from "../request-parsers";
import * as marketplaceStore from "../marketplace-store";

export async function routeMarketplace(
  sql: DurableObjectStorage["sql"],
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/marketplace/config") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      return Response.json(
        marketplaceStore.readMarketplaceConfig(sql, guildId) ??
          marketplaceStore.defaultMarketplaceConfig(guildId),
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/marketplace/config") {
    try {
      const body = parseMarketplaceConfig(await request.json());
      marketplaceStore.upsertMarketplaceConfig(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/marketplace/posts") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const activeOnly = url.searchParams.get("activeOnly") === "1";
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      return Response.json(
        marketplaceStore.listMarketplacePosts(sql, guildId, { activeOnly, limit }),
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/marketplace/post") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const postId = asRequiredSearchParam(url.searchParams, "postId");
      return Response.json(marketplaceStore.readMarketplacePost(sql, guildId, postId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/marketplace/post/active-by-owner") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const ownerId = asRequiredSearchParam(url.searchParams, "ownerId");
      return Response.json(
        marketplaceStore.readActiveMarketplacePostByOwner(sql, guildId, ownerId),
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/marketplace/post") {
    try {
      const body = parseMarketplacePost(await request.json());
      marketplaceStore.createMarketplacePost(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/marketplace/post/message") {
    try {
      const body = parseMarketplacePostMessage(await request.json());
      marketplaceStore.updateMarketplacePostMessage(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/marketplace/post/close") {
    try {
      const body = parseMarketplacePostClose(await request.json());
      return Response.json(marketplaceStore.closeMarketplacePost(sql, body));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/marketplace/logs") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
      return Response.json(marketplaceStore.listMarketplaceLogs(sql, guildId, limit));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/marketplace/log") {
    try {
      const body = parseMarketplaceLog(await request.json());
      marketplaceStore.createMarketplaceLog(sql, body);
      return Response.json({ ok: true });
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
