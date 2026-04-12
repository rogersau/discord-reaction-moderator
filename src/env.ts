import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  BLOCKLIST_KV: KVNamespace;
  DISCORD_BOT_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  BOT_USER_ID: string;
  ADMIN_AUTH_SECRET?: string;
  GATEWAY_SESSION_DO?: DurableObjectNamespace;
  MODERATION_STORE_DO?: DurableObjectNamespace;
}
