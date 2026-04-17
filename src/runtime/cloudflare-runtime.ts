import { createRuntimeApp } from "./app";
import { getModerationStoreStub } from "../reaction-moderation";
import { assertValidDiscordPublicKey } from "../discord";
import type { Env } from "../env";
import type { AppConfigMutation } from "./admin-types";

export function createCloudflareRuntime(env: Env) {
  const discordPublicKey = assertValidDiscordPublicKey(env.DISCORD_PUBLIC_KEY);
  const gatewayStub = env.GATEWAY_SESSION_DO.get(
    env.GATEWAY_SESSION_DO.idFromName("gateway-session")
  );
  const storeStub = getModerationStoreStub(env);

  return createRuntimeApp({
    discordPublicKey,
    discordBotToken: env.DISCORD_BOT_TOKEN,
    discordApplicationId: env.DISCORD_APPLICATION_ID,
    adminAuthSecret: env.ADMIN_AUTH_SECRET,
    adminSessionSecret: env.ADMIN_AUTH_SECRET ?? env.ADMIN_UI_PASSWORD,
    adminUiPassword: env.ADMIN_UI_PASSWORD,
    store: {
      async readConfig() {
        const response = await storeStub.fetch("https://moderation-store/config");
        return response.json();
      },
      async upsertAppConfig(body: AppConfigMutation) {
        const response = await storeStub.fetch("https://moderation-store/app-config", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`Failed to upsert app config: ${response.status} ${await response.text()}`);
        }
      },
      async applyGuildEmojiMutation(body) {
        const response = await storeStub.fetch("https://moderation-store/guild-emoji", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return response.json();
      },
      async listTimedRolesByGuild(guildId) {
        const response = await storeStub.fetch(`https://moderation-store/timed-roles?guildId=${encodeURIComponent(guildId)}`);
        return response.json();
      },
      async listTimedRoles() {
        const response = await storeStub.fetch("https://moderation-store/timed-roles");
        return response.json();
      },
      async upsertTimedRole(body) {
        const response = await storeStub.fetch("https://moderation-store/timed-role", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`Failed to upsert timed role: ${response.status} ${await response.text()}`);
        }
      },
      async deleteTimedRole(body) {
        const response = await storeStub.fetch("https://moderation-store/timed-role/remove", {
          method: "POST",
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`Failed to delete timed role: ${response.status} ${await response.text()}`);
        }
      },
      async listExpiredTimedRoles() {
        // Cloudflare: Durable Object alarms handle expiry, not polling
        return [];
      },
      async readGatewaySnapshot() {
        const response = await gatewayStub.fetch("https://gateway-session/status");
        return response.json();
      },
      async writeGatewaySnapshot() {
        // Cloudflare: Gateway session state persists in Durable Object storage
      },
    },
    gateway: {
      async start() {
        const response = await gatewayStub.fetch("https://gateway-session/start", { method: "POST" });
        return response.json();
      },
      async status() {
        const response = await gatewayStub.fetch("https://gateway-session/status");
        return response.json();
      },
    },
  });
}
