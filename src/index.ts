/**
 * Discord Automation Workers - Cloudflare Worker suite
 *
 * Public entry point for health checks, admin APIs, and scheduled gateway bootstrap.
 */

import { GatewaySessionDO } from "./durable-objects/gateway-session";
import { CommunityStoreDO } from "./durable-objects/community-store";
import type { Env } from "./env";
import { createCloudflareRuntime } from "./runtime/cloudflare-runtime";

export { GatewaySessionDO, CommunityStoreDO, CommunityStoreDO as ModerationStoreDO };

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    return createCloudflareRuntime(env).fetch(request);
  },

  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    const runtime = createCloudflareRuntime(env);
    ctx.waitUntil(runtime.bootstrap());
  },
};
