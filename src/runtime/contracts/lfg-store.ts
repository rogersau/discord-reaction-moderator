import type { LfgConfig, LfgPost } from "../../types";

export interface LfgStore {
  readLfgConfig(guildId: string): Promise<LfgConfig | null>;
  upsertLfgConfig(config: LfgConfig): Promise<void>;
  listLfgPosts(
    guildId: string,
    options?: { activeOnly?: boolean; limit?: number },
  ): Promise<LfgPost[]>;
  readLfgPost(guildId: string, postId: string): Promise<LfgPost | null>;
  readActiveLfgPostByOwner(
    guildId: string,
    ownerId: string,
  ): Promise<LfgPost | null>;
  createLfgPost(post: LfgPost): Promise<void>;
  updateLfgPostMessage(body: {
    guildId: string;
    postId: string;
    messageId: string;
  }): Promise<void>;
  closeLfgPost(body: {
    guildId: string;
    postId: string;
    closedByUserId: string;
    closedAtMs: number;
  }): Promise<LfgPost>;
}
