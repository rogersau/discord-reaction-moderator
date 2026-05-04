import type { DurableObjectStorage } from "@cloudflare/workers-types";
import {
  CommunityStoreInputError,
  parseGuildIdRequest,
  parseTicketPanelConfig,
  parseTicketInstance,
  parseTicketDeleteRequest,
  parseTicketCloseRequest,
  asRequiredSearchParam,
} from "../request-parsers";
import * as ticketStore from "../ticket-store";

export async function routeTicket(
  sql: DurableObjectStorage["sql"],
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/ticket-number/next") {
    try {
      const body = parseGuildIdRequest(await request.json());
      return Response.json({ ticketNumber: ticketStore.reserveNextTicketNumber(sql, body.guildId) });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/ticket-panel") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      return Response.json(ticketStore.readTicketPanelConfig(sql, guildId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/ticket-panel") {
    try {
      const body = parseTicketPanelConfig(await request.json());
      ticketStore.upsertTicketPanelConfig(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/ticket-instance") {
    try {
      const body = parseTicketInstance(await request.json());
      ticketStore.createTicketInstance(sql, body);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "GET" && url.pathname === "/ticket-instance/open") {
    try {
      const guildId = asRequiredSearchParam(url.searchParams, "guildId");
      const channelId = asRequiredSearchParam(url.searchParams, "channelId");
      return Response.json(ticketStore.readOpenTicketByChannel(sql, guildId, channelId));
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/ticket-instance/delete") {
    try {
      const body = parseTicketDeleteRequest(await request.json());
      ticketStore.deleteTicketInstance(sql, body.guildId, body.channelId);
      return Response.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  }

  if (request.method === "POST" && url.pathname === "/ticket-instance/close") {
    try {
      const body = parseTicketCloseRequest(await request.json());
      ticketStore.closeTicketInstance(sql, body);
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
