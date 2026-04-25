import {
  buildTicketTranscriptStorageKey,
} from "../tickets";
import type { TicketTranscriptBlobStore } from "../runtime/contracts";

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

export interface PublicRouteOptions {
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}

export function createPublicRoutes(options: PublicRouteOptions = {}): RouteHandler {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    const transcriptMatch = /^\/transcripts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && transcriptMatch) {
      const guildId = decodeURIComponent(transcriptMatch[1] ?? "");
      const channelId = decodeURIComponent(transcriptMatch[2] ?? "");
      const html = options.ticketTranscriptBlobs
        ? await options.ticketTranscriptBlobs.getHtml(
            buildTicketTranscriptStorageKey(guildId, channelId)
          )
        : null;

      if (!html) {
        return Response.json({ error: "Transcript not found" }, { status: 404 });
      }

      return new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    return null;
  };
}
