export interface Env {
  DISCORD_BOT_TOKEN: string;
  BOT_USER_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  ADMIN_AUTH_SECRET?: string;
  ADMIN_UI_PASSWORD?: string;
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
