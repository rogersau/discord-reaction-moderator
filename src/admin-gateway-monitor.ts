export interface GatewayStatusMonitorOptions<TStatus> {
  intervalMs: number;
  loadStatus: () => Promise<TStatus>;
  onStatus: (status: TStatus) => void;
  onError: (error: unknown) => void;
  setInterval: (callback: () => void, delayMs: number) => unknown;
  clearInterval: (timer: unknown) => void;
}

export interface GatewayStatusMonitor {
  refresh: () => Promise<void>;
  stop: () => void;
}

export function startGatewayStatusMonitor<TStatus>(
  options: GatewayStatusMonitorOptions<TStatus>,
): GatewayStatusMonitor {
  let stopped = false;
  let inFlight = false;

  const refresh = async () => {
    if (stopped || inFlight) {
      return;
    }

    inFlight = true;
    try {
      const status = await options.loadStatus();
      if (!stopped) {
        options.onStatus(status);
      }
    } catch (error) {
      if (!stopped) {
        options.onError(error);
      }
    } finally {
      inFlight = false;
    }
  };

  void refresh();

  const timer = options.setInterval(() => {
    void refresh();
  }, options.intervalMs);

  return {
    refresh,
    stop() {
      stopped = true;
      options.clearInterval(timer);
    },
  };
}
