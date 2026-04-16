export interface NodeRuntimeConfig {
  discordBotToken: string;
  botUserId: string;
  discordPublicKey: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
  adminSessionSecret?: string;
  adminUiPassword?: string;
  port: number;
  sqlitePath: string;
}

export function loadNodeRuntimeConfig(env: Record<string, string | undefined>): NodeRuntimeConfig {
  const discordBotToken = requireValue(env, "DISCORD_BOT_TOKEN");
  const botUserId = requireValue(env, "BOT_USER_ID");
  const discordPublicKey = requireValue(env, "DISCORD_PUBLIC_KEY");
  const sqlitePath = requireValue(env, "SQLITE_PATH");
  const portText = env.PORT ?? "8787";
  const port = Number.parseInt(portText, 10);

  if (!Number.isInteger(port) || port <= 0 || port > 65535 || portText !== port.toString()) {
    throw new Error(`PORT must be a valid port number (1-65535), received: ${portText}`);
  }

  return {
    discordBotToken,
    botUserId,
    discordPublicKey,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    adminSessionSecret: env.ADMIN_AUTH_SECRET ?? env.ADMIN_UI_PASSWORD,
    adminUiPassword: env.ADMIN_UI_PASSWORD,
    port,
    sqlitePath,
  };
}

function requireValue(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}
