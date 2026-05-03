import type { MarketplaceBusinessLog, MarketplaceConfig, MarketplacePost } from "../../types";

export interface MarketplaceStore {
  readMarketplaceConfig(guildId: string): Promise<MarketplaceConfig | null>;
  upsertMarketplaceConfig(config: MarketplaceConfig): Promise<void>;
  listMarketplacePosts(
    guildId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<MarketplacePost[]>;
  readMarketplacePost(guildId: string, postId: string): Promise<MarketplacePost | null>;
  readActiveMarketplacePostByOwner(
    guildId: string,
    ownerId: string,
  ): Promise<MarketplacePost | null>;
  createMarketplacePost(post: MarketplacePost): Promise<void>;
  updateMarketplacePostMessage(body: {
    guildId: string;
    postId: string;
    messageId: string;
  }): Promise<void>;
  closeMarketplacePost(body: {
    guildId: string;
    postId: string;
    closedByUserId: string;
    closedAtMs: number;
  }): Promise<MarketplacePost>;
  listMarketplaceLogs(guildId: string, limit?: number): Promise<MarketplaceBusinessLog[]>;
  createMarketplaceLog(log: MarketplaceBusinessLog): Promise<void>;
}
