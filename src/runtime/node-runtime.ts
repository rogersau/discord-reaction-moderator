import type { ClosableRuntimeStore, ManagedGatewayController } from "./contracts";

interface PortableRuntimeConfig {
  port: number;
}

interface PortableRuntimeApp {
  bootstrap(): Promise<unknown>;
  fetch(request: Request): Promise<Response>;
}

interface PortableRuntimeScheduler {
  start(): Promise<void>;
  stop(): void;
}

interface PortableRuntimeServer {
  close(callback?: (error?: Error) => void): void;
}

interface PortableRuntimeLogger {
  log(message: string): void;
  error(message: string, error: unknown): void;
}

interface StartPortableRuntimeOptions {
  config: PortableRuntimeConfig;
  app: PortableRuntimeApp;
  store: ClosableRuntimeStore;
  gateway: ManagedGatewayController;
  scheduler: PortableRuntimeScheduler;
  startServer(options: {
    port: number;
    app: PortableRuntimeApp;
  }): Promise<PortableRuntimeServer>;
  registerSignalHandler(signal: "SIGINT" | "SIGTERM", handler: () => void): void;
  logger: PortableRuntimeLogger;
}

export interface PortableRuntimeHandle {
  shutdown(): Promise<void>;
}

export async function startPortableRuntime(
  options: StartPortableRuntimeOptions
): Promise<PortableRuntimeHandle> {
  const server = await options.startServer({
    port: options.config.port,
    app: options.app,
  });

  let shutdownPromise: Promise<void> | undefined;

  const shutdown = () => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = closeServer(server).then(() => {
      options.scheduler.stop();
      options.gateway.stop();
      options.store.close();
    });

    return shutdownPromise;
  };

  options.scheduler.start().catch((error) => {
    options.logger.error("Failed to start timed-role scheduler", error);
  });

  try {
    await options.app.bootstrap();
  } catch (error) {
    await shutdown();
    throw error;
  }

  options.registerSignalHandler("SIGINT", () => {
    void shutdown();
  });
  options.registerSignalHandler("SIGTERM", () => {
    void shutdown();
  });

  options.logger.log(`Portable runtime listening on port ${options.config.port}`);

  return { shutdown };
}

function closeServer(server: PortableRuntimeServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
