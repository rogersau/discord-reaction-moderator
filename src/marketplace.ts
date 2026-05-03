import type {
  MarketplaceBusinessLog,
  MarketplaceConfig,
  MarketplacePost,
  MarketplaceTradeType,
} from "./types";

export type MarketplaceCustomId =
  | { action: "create" }
  | { action: "type"; tradeType: MarketplaceTradeType }
  | { action: "server"; tradeType: MarketplaceTradeType; serverId: string }
  | { action: "modal"; tradeType: MarketplaceTradeType; serverId: string }
  | { action: "business"; postId: string }
  | { action: "confirm"; postId: string }
  | { action: "close"; postId: string };

export function parseMarketplaceCustomId(customId: string): MarketplaceCustomId | null {
  const parts = customId.split(":");
  if (parts[0] !== "market") return null;

  if (parts[1] === "create") return { action: "create" };
  if (parts[1] === "type" && isTradeType(parts[2])) {
    return { action: "type", tradeType: parts[2] };
  }
  if (parts[1] === "server" && isTradeType(parts[2]) && parts[3]) {
    return { action: "server", tradeType: parts[2], serverId: parts.slice(3).join(":") };
  }
  if (parts[1] === "modal" && isTradeType(parts[2]) && parts[3]) {
    return { action: "modal", tradeType: parts[2], serverId: parts.slice(3).join(":") };
  }
  if (parts[1] === "biz" && parts[2])
    return { action: "business", postId: parts.slice(2).join(":") };
  if (parts[1] === "confirm" && parts[2])
    return { action: "confirm", postId: parts.slice(2).join(":") };
  if (parts[1] === "close" && parts[2])
    return { action: "close", postId: parts.slice(2).join(":") };

  return null;
}

export function buildMarketplaceNoticeMessage() {
  return {
    embeds: [
      {
        title: "💼 Marketplace Noticeboard",
        description: "Create a marketplace post. Click the button below to start.",
        color: 0x3498db,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: "market:create",
            label: "Create Marketplace Post",
            emoji: { name: "💼" },
            style: 1,
          },
        ],
      },
    ],
  };
}

export function buildMarketplaceTypeResponse() {
  return {
    type: 4,
    data: {
      content: "What type of marketplace post do you want to create?",
      flags: 64,
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: "market:type:have",
              label: "I have an item to trade",
              emoji: { name: "📦" },
              style: 3,
            },
            {
              type: 2,
              custom_id: "market:type:want",
              label: "I am looking for an item",
              emoji: { name: "🔎" },
              style: 1,
            },
          ],
        },
      ],
    },
  };
}

export function buildMarketplaceServerResponse(
  config: MarketplaceConfig,
  tradeType: MarketplaceTradeType,
) {
  return {
    type: 7,
    data: {
      content: "Which server is this for?",
      components: chunk(config.serverOptions, 5).map((serverOptions) => ({
        type: 1,
        components: serverOptions.map((option) => ({
          type: 2,
          custom_id: `market:server:${tradeType}:${option.id}`,
          label: option.label,
          emoji: option.emoji ? { name: option.emoji } : undefined,
          style: 2,
        })),
      })),
    },
  };
}

export function buildMarketplacePostModal(tradeType: MarketplaceTradeType, serverId: string) {
  return {
    type: 9,
    data: {
      custom_id: `market:modal:${tradeType}:${serverId}`,
      title: "Create Marketplace Post",
      components: [
        inputRow("have", "What do you have for trade?", tradeType === "have", 900),
        inputRow("want", "Is there something you are looking for?", tradeType === "want", 900),
        inputRow("extra", "Extra info", false, 700),
      ],
    },
  };
}

export function buildMarketplacePostMessage(post: MarketplacePost) {
  const closed = !post.active;
  return {
    embeds: [
      {
        title: closed ? "🔒 Marketplace Listing Closed" : "💼 Marketplace Listing",
        color: closed ? 0x777777 : 0x2ecc71,
        fields: [
          {
            name: "Type",
            value: post.tradeType === "have" ? "Have item to trade" : "Looking for item",
            inline: true,
          },
          { name: "Server", value: post.serverLabel, inline: true },
          {
            name: "What do you have for trade?",
            value: truncateField(post.have || "Not specified"),
          },
          {
            name: "Is there something you are looking for?",
            value: truncateField(post.want || "Not specified"),
          },
          { name: "Extra info", value: truncateField(post.extra || "None") },
          { name: "Posted by", value: `<@${post.ownerId}>` },
        ],
        footer: { text: `Post ID: ${post.id}` },
        timestamp: new Date(post.createdAtMs).toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `market:biz:${post.id}`,
            label: "Do Business",
            emoji: { name: "💼" },
            style: 3,
            disabled: closed,
          },
          {
            type: 2,
            custom_id: `market:close:${post.id}`,
            label: "Close Post",
            emoji: { name: "🔒" },
            style: 4,
            disabled: closed,
          },
        ],
      },
    ],
  };
}

export function buildMarketplaceWarningResponse(postId: string) {
  return {
    type: 4,
    data: {
      flags: 64,
      content: [
        "⚠️ **Marketplace Notice**",
        "",
        "All trades arranged through this Discord marketplace must follow server rules.",
        "",
        "**Scamming, misleading, betraying, or setting players up through marketplace deals may result in a ban.**",
        "",
        "Only continue if you agree to do business fairly.",
      ].join("\n"),
      components: [
        {
          type: 1,
          components: [
            {
              type: 2,
              custom_id: `market:confirm:${postId}`,
              label: "Confirm & Do Business",
              emoji: { name: "💼" },
              style: 4,
            },
          ],
        },
      ],
    },
  };
}

export function buildMarketplaceDmMessage(
  buyerId: string,
  buyerDisplayName: string,
  post: MarketplacePost,
) {
  return {
    content: [
      "💼 **Someone wants to do business with you!**",
      "",
      `User: <@${buyerId}> (${buyerDisplayName})`,
      `Server: **${post.serverLabel}**`,
      "",
      "**Marketplace post:**",
      `Have: ${post.have || "Not specified"}`,
      `Looking for: ${post.want || "Not specified"}`,
      "",
      "You can DM them directly or add them as a Discord friend.",
      "",
      "**Reminder:** Trades arranged through the Discord marketplace must follow server rules.",
    ].join("\n"),
    allowed_mentions: { users: [buyerId] },
  };
}

export function buildMarketplaceLogMessage(log: MarketplaceBusinessLog) {
  return {
    embeds: [
      {
        title: "💼 Marketplace Business Logged",
        color: 0xf1c40f,
        fields: [
          { name: "Interested user", value: `<@${log.buyerId}> (${log.buyerDisplayName})` },
          { name: "Post owner", value: `<@${log.sellerId}>` },
          { name: "Server", value: log.serverLabel, inline: true },
          { name: "Post ID", value: log.postId, inline: true },
          { name: "DM sent", value: log.dmSent ? "Yes" : "No", inline: true },
          { name: "Have", value: truncateField(log.have || "Not specified") },
          { name: "Looking for", value: truncateField(log.want || "Not specified") },
        ],
        timestamp: new Date(log.timestampMs).toISOString(),
      },
    ],
  };
}

export function formatMarketplaceLogs(logs: MarketplaceBusinessLog[]): string {
  if (logs.length === 0) return "No marketplace business logs found yet.";

  return logs
    .map((log, index) => {
      const time = Math.floor(log.timestampMs / 1000);
      return `**${index + 1}.** <@${log.buyerId}> clicked Do Business with <@${log.sellerId}>\nServer: **${log.serverLabel}** | Post: \`${log.postId}\` | <t:${time}:R>`;
    })
    .join("\n\n");
}

function inputRow(customId: string, label: string, required: boolean, maxLength: number) {
  return {
    type: 1,
    components: [
      {
        type: 4,
        custom_id: customId,
        label,
        style: 2,
        required,
        max_length: maxLength,
      },
    ],
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function truncateField(value: string): string {
  return value.length <= 1024 ? value : `${value.slice(0, 1020)}...`;
}

function isTradeType(value: unknown): value is MarketplaceTradeType {
  return value === "have" || value === "want";
}
