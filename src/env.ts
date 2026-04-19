export interface Env {
  DISCORD_BOT_TOKEN: string;
  BOT_USER_ID: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  
  // Legacy: Used for bearer auth on legacy admin routes (if configured)
  ADMIN_AUTH_SECRET?: string;
  
  // Required for admin dashboard login
  ADMIN_UI_PASSWORD?: string;
  
  // Required: Dedicated secret for signing admin session cookies.
  // Does NOT fall back to ADMIN_AUTH_SECRET or ADMIN_UI_PASSWORD.
  // Must be set explicitly to enable secure session-based admin authentication.
  ADMIN_SESSION_SECRET?: string;
  
  GATEWAY_SESSION_DO: DurableObjectNamespace;
  MODERATION_STORE_DO: DurableObjectNamespace;
}
