import {
  buildTicketTranscriptAttachmentStorageKey,
  buildTicketTranscriptStorageKey,
} from "../tickets";
import type { TicketTranscriptBlobStore } from "../runtime/contracts";
import type { FeatureFlags } from "../runtime/features";

export interface RouteHandler {
  (request: Request): Promise<Response | null>;
}

export interface PublicRouteOptions {
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
  features: FeatureFlags;
}

export function createPublicRoutes(options: PublicRouteOptions): RouteHandler {
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    const transcriptMediaMatch =
      options.features.tickets &&
      /^\/transcripts\/([^/]+)\/([^/]+)\/media\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (request.method === "GET" && transcriptMediaMatch) {
      const guildId = decodeURIComponent(transcriptMediaMatch[1] ?? "");
      const channelId = decodeURIComponent(transcriptMediaMatch[2] ?? "");
      const attachmentId = decodeURIComponent(transcriptMediaMatch[3] ?? "");
      const filename = decodeURIComponent(transcriptMediaMatch[4] ?? "");
      const attachment = options.ticketTranscriptBlobs
        ? await options.ticketTranscriptBlobs.getAttachment(
            buildTicketTranscriptAttachmentStorageKey(guildId, channelId, attachmentId, filename),
          )
        : null;

      if (!attachment) {
        return Response.json({ error: "Transcript attachment not found" }, { status: 404 });
      }

      return new Response(attachment.body, {
        status: 200,
        headers: {
          "content-type": attachment.contentType ?? "application/octet-stream",
          "cache-control": "public, max-age=31536000, immutable",
          "x-content-type-options": "nosniff",
        },
      });
    }

    const transcriptMatch =
      options.features.tickets && /^\/transcripts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && transcriptMatch) {
      const guildId = decodeURIComponent(transcriptMatch[1] ?? "");
      const channelId = decodeURIComponent(transcriptMatch[2] ?? "");
      const html = options.ticketTranscriptBlobs
        ? await options.ticketTranscriptBlobs.getHtml(
            buildTicketTranscriptStorageKey(guildId, channelId),
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
          "content-security-policy":
            "default-src 'none'; img-src 'self' https: data:; media-src 'self' https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return null;
  };
}
