import type { RuntimeStore } from "./contracts";

interface TimerLike {
  stop(): void;
}

interface TimedRoleSchedulerOptions {
  now: () => number;
  store: RuntimeStore;
  removeGuildMemberRole: (guildId: string, userId: string, roleId: string) => Promise<void>;
  setTimer: (callback: () => void | Promise<void>, delayMs: number) => TimerLike;
}

export function createTimedRoleScheduler(options: TimedRoleSchedulerOptions) {
  let timer: TimerLike | null = null;
  let processPromise: Promise<void> | null = null;

  return {
    async start(): Promise<void> {
      await runProcessExpiredRoles();
      
      if (timer) {
        timer.stop();
      }
      timer = options.setTimer(async () => {
        await runProcessExpiredRoles();
      }, 1000);
    },

    stop(): void {
      if (timer) {
        timer.stop();
        timer = null;
      }
    },
  };

  async function runProcessExpiredRoles(): Promise<void> {
    if (processPromise) {
      return processPromise;
    }

    processPromise = processExpiredRoles();

    try {
      await processPromise;
    } finally {
      processPromise = null;
    }
  }

  async function processExpiredRoles(): Promise<void> {
    const expired = await options.store.listExpiredTimedRoles(options.now());

    for (const assignment of expired) {
      try {
        await options.removeGuildMemberRole(
          assignment.guildId,
          assignment.userId,
          assignment.roleId
        );
        await options.store.deleteTimedRole({
          guildId: assignment.guildId,
          userId: assignment.userId,
          roleId: assignment.roleId,
        });
        console.log(
          `Removed expired timed role ${assignment.roleId} from user ${assignment.userId} in guild ${assignment.guildId}`
        );
      } catch (error) {
        console.error(
          `Failed to remove expired timed role ${assignment.roleId} from user ${assignment.userId}:`,
          error
        );
      }
    }
  }
}
