import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  CommunityStoreInputError,
  parseTimedRoleUpsert,
  parseTimedRoleRemoval,
  parseNewMemberTimedRoleConfig,
  asRequiredSearchParam,
} from "../request-parsers";
import * as timedRoleStore from "../timed-role-store";

export async function routeTimedRole(
  sql: DurableObjectStorage["sql"],
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/timed-role") {
    try {
      const body = parseTimedRoleUpsert(await request.json());
      timedRoleStore.upsertTimedRole(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/timed-role/remove") {
    try {
      const body = parseTimedRoleRemoval(await request.json());
      timedRoleStore.deleteTimedRole(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/timed-roles") {
    try {
      const guildId = url.searchParams.get("guildId");
      return Response.json(
        guildId ? timedRoleStore.listTimedRolesByGuild(sql, guildId) : timedRoleStore.listTimedRoles(sql),
      );
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/timed-role/new-member-config") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      return Response.json(timedRoleStore.readNewMemberTimedRoleConfig(sql, guildId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/timed-role/new-member-config") {
    try {
      const body = parseNewMemberTimedRoleConfig(await request.json());
      timedRoleStore.upsertNewMemberTimedRoleConfig(sql, body);
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
