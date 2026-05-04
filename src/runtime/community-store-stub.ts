import type { Env } from "../env";

export function getCommunityStoreStub(env: Pick<Env, "COMMUNITY_STORE_DO">): DurableObjectStub {
  const storeId = env.COMMUNITY_STORE_DO.idFromName("community-store");
  return env.COMMUNITY_STORE_DO.get(storeId);
}
