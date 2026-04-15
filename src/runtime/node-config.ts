export interface NodeRuntimeConfig {
  discordBotToken: string;
  botUserId: string;
  discordPublicKey: string;
  discordApplicationId?: string;
  adminAuthSecret?: string;
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

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, received: ${portText}`);
  }

  return {
    discordBotToken,
    botUserId,
    discordPublicKey,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
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
