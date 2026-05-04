import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  CommunityStoreInputError,
  parseLfgConfig,
  parseLfgPost,
  parseLfgPostClose,
  parseLfgPostMessage,
  asRequiredSearchParam,
} from "../request-parsers";
import * as lfgStore from "../lfg-store";

export async function routeLfg(
  sql: DurableObjectStorage["sql"],
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/lfg/config") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      return Response.json(lfgStore.readLfgConfig(sql, guildId) ?? lfgStore.defaultLfgConfig(guildId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/lfg/config") {
    try {
      const body = parseLfgConfig(await request.json());
      lfgStore.upsertLfgConfig(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/lfg/posts") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const activeOnly = url.searchParams.get("activeOnly") === "1";
      const limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
      return Response.json(lfgStore.listLfgPosts(sql, guildId, { activeOnly, limit }));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/lfg/post") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const postId = asRequiredSearchParam(url.searchParams, "postId");
      return Response.json(lfgStore.readLfgPost(sql, guildId, postId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/lfg/post/active-by-owner") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const ownerId = asRequiredSearchParam(url.searchParams, "ownerId");
      return Response.json(lfgStore.readActiveLfgPostByOwner(sql, guildId, ownerId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/lfg/post") {
    try {
      const body = parseLfgPost(await request.json());
      lfgStore.createLfgPost(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/lfg/post/message") {
    try {
      const body = parseLfgPostMessage(await request.json());
      lfgStore.updateLfgPostMessage(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/lfg/post/close") {
    try {
      const body = parseLfgPostClose(await request.json());
      return Response.json(lfgStore.closeLfgPost(sql, body));
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
