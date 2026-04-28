import type { Env } from "../env";
import { assertValidDiscordPublicKey } from "../discord";
import { getModerationStoreStub } from "../reaction-moderation";
import { createCloudflareStoreClient } from "./cloudflare-store-client";
import { createCloudflareGatewayClient } from "./cloudflare-gateway-client";
import type {
  GatewayController,
  TicketTranscriptBlobStore,
  BlocklistStore,
  AppConfigStore,
  TimedRoleStore,
  TicketStore,
} from "./contracts";

export interface RuntimeAppContext {
  discordPublicKey: string;
  discordBotToken: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminUiPassword?: string;
  adminSessionSecret?: string;
  verifyDiscordRequest?: (timestamp: string, body: string, signature: string) => Promise<boolean>;
  stores: {
    blocklist: BlocklistStore;
    appConfig: AppConfigStore;
    timedRoles: TimedRoleStore;
    tickets: TicketStore;
  };
  gateway: GatewayController;
  ticketTranscriptBlobs?: TicketTranscriptBlobStore;
}

export function createCloudflareContext(env: Env): RuntimeAppContext {
  const gatewayStub = env.GATEWAY_SESSION_DO.get(env.GATEWAY_SESSION_DO.idFromName("gateway-session"));
  const storeStub = getModerationStoreStub(env);

  const storeClient = createCloudflareStoreClient(storeStub);
  const gatewayClient = createCloudflareGatewayClient(gatewayStub);
  const blocklistStore = {
    readConfig: storeClient.readConfig,
    applyGuildEmojiMutation: storeClient.applyGuildEmojiMutation,
    readGuildNotificationChannel: storeClient.readGuildNotificationChannel,
    upsertGuildNotificationChannel: storeClient.upsertGuildNotificationChannel,
  };
  const ticketTranscriptBlobs: TicketTranscriptBlobStore | undefined = env.TICKET_TRANSCRIPTS_BUCKET
    ? {
        async putHtml(key: string, html: string): Promise<void> {
          await env.TICKET_TRANSCRIPTS_BUCKET?.put(key, html, {
            httpMetadata: {
              contentType: "text/html; charset=utf-8",
            },
          });
        },
        async getHtml(key: string): Promise<string | null> {
          const object = await env.TICKET_TRANSCRIPTS_BUCKET?.get(key);
          if (!object) {
            return null;
          }

          return object.text();
        },
        async putAttachment(
          key: string,
          body: ReadableStream<Uint8Array> | ArrayBuffer | string,
          options: { contentType: string | null }
        ): Promise<void> {
          await env.TICKET_TRANSCRIPTS_BUCKET?.put(key, body, {
            httpMetadata: options.contentType
              ? {
                  contentType: options.contentType,
                }
              : undefined,
          });
        },
        async getAttachment(key: string): Promise<{
          body: ReadableStream<Uint8Array> | ArrayBuffer | string;
          contentType: string | null;
        } | null> {
          const object = await env.TICKET_TRANSCRIPTS_BUCKET?.get(key);
          if (!object) {
            return null;
          }

          return {
            body: object.body,
            contentType: object.httpMetadata?.contentType ?? null,
          };
        },
      }
    : undefined;

  const context: RuntimeAppContext = {
    discordPublicKey: assertValidDiscordPublicKey(env.DISCORD_PUBLIC_KEY),
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    adminUiPassword: env.ADMIN_UI_PASSWORD,
    adminSessionSecret: env.ADMIN_SESSION_SECRET,
    stores: {
      blocklist: blocklistStore as BlocklistStore,
      appConfig: {
        upsertAppConfig: storeClient.upsertAppConfig,
      },
      timedRoles: {
        listTimedRoles: storeClient.listTimedRoles,
        listTimedRolesByGuild: storeClient.listTimedRolesByGuild,
        upsertTimedRole: storeClient.upsertTimedRole,
        deleteTimedRole: storeClient.deleteTimedRole,
        async listExpiredTimedRoles() {
          // Cloudflare: Durable Object alarms handle expiry automatically; polling not needed
          return [];
        },
      },
      tickets: {
        reserveNextTicketNumber: storeClient.reserveNextTicketNumber,
        readTicketPanelConfig: storeClient.readTicketPanelConfig,
        upsertTicketPanelConfig: storeClient.upsertTicketPanelConfig,
        createTicketInstance: storeClient.createTicketInstance,
        deleteTicketInstance: storeClient.deleteTicketInstance,
        readOpenTicketByChannel: storeClient.readOpenTicketByChannel,
        closeTicketInstance: storeClient.closeTicketInstance,
      },
    },
    gateway: {
      start: gatewayClient.start,
      status: gatewayClient.status,
    },
    ticketTranscriptBlobs,
  };

  return context;
}
