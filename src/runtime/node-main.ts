import WebSocket, { type RawData } from "ws";

import { removeGuildMemberRole } from "../discord";
import { loadNodeRuntimeConfig } from "./node-config";
import { createNodeGatewayService } from "./node-gateway-service";
import { createRuntimeApp } from "./app";
import { startPortableRuntime } from "./node-runtime";
import { createTimedRoleScheduler } from "./node-scheduler";
import { startNodeRuntimeServer } from "./node-server";
import { createSqliteRuntimeStore } from "./sqlite-store";

async function main(): Promise<void> {
  const config = loadNodeRuntimeConfig(process.env);
  const store = createSqliteRuntimeStore({
    sqlitePath: config.sqlitePath,
    botUserId: config.botUserId,
  });
  const setTimer = (callback: () => void | Promise<void>, delayMs: number) => {
    const timer = setTimeout(() => {
      void callback();
    }, delayMs);
    return {
      stop() {
        clearTimeout(timer);
      },
    };
  };
  const gateway = createNodeGatewayService({
    botToken: config.discordBotToken,
    store,
    openWebSocket(url, handlers) {
      const socket = new WebSocket(url);
      socket.on("message", (payload: RawData) => {
        handlers.onMessage(rawDataToString(payload));
      });
      socket.on("close", () => {
        handlers.onClose();
      });
      socket.on("error", () => {
        handlers.onError();
      });
      return {
        send(data: string) {
          socket.send(data);
        },
        close() {
          socket.close();
        },
      };
    },
    setTimer,
  });
  const scheduler = createTimedRoleScheduler({
    now: () => Date.now(),
    store,
    removeGuildMemberRole: (guildId, userId, roleId) =>
      removeGuildMemberRole(guildId, userId, roleId, config.discordBotToken),
    setTimer,
  });
  const app = createRuntimeApp({
    discordPublicKey: config.discordPublicKey,
    discordBotToken: config.discordBotToken,
    discordApplicationId: config.discordApplicationId,
    adminAuthSecret: config.adminAuthSecret,
    store,
    gateway,
  });
  await startPortableRuntime({
    config: { port: config.port },
    app,
    store,
    gateway,
    scheduler,
    startServer: startNodeRuntimeServer,
    registerSignalHandler(signal, handler) {
      process.on(signal, handler);
    },
    logger: console,
  });
}

void main().catch((error) => {
  console.error("Failed to start portable runtime", error);
  process.exitCode = 1;
});

function rawDataToString(payload: RawData): string {
  if (typeof payload === "string") {
    return payload;
  }
  if (Array.isArray(payload)) {
    return Buffer.concat(payload).toString("utf8");
  }
  if (Buffer.isBuffer(payload)) {
    return payload.toString("utf8");
  }
  return Buffer.from(payload).toString("utf8");
}
