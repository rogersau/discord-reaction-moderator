import type { LfgConfig, LfgPost } from "./types";

export type LfgCustomId =
  | { action: "create" }
  | { action: "server"; serverId: string }
  | { action: "modal"; serverId: string }
  | { action: "interested"; postId: string }
  | { action: "close"; postId: string };

export function parseLfgCustomId(customId: string): LfgCustomId | null {
  const parts = customId.split(":");
  if (parts[0] !== "lfg") return null;

  if (parts[1] === "create") return { action: "create" };
  if (parts[1] === "server" && parts[2]) {
    return { action: "server", serverId: parts.slice(2).join(":") };
  }
  if (parts[1] === "modal" && parts[2]) {
    return { action: "modal", serverId: parts.slice(2).join(":") };
  }
  if (parts[1] === "interested" && parts[2]) {
    return { action: "interested", postId: parts.slice(2).join(":") };
  }
  if (parts[1] === "close" && parts[2]) {
    return { action: "close", postId: parts.slice(2).join(":") };
  }

  return null;
}

export function buildLfgNoticeMessage() {
  return {
    embeds: [
      {
        title: "🎮 Looking For Gamers",
        description:
          "Looking for someone to play with? Click the button below and fill out a quick post.",
        color: 0x2b2d31,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: "lfg:create",
            label: "Create LFG Post",
            emoji: { name: "🎮" },
            style: 1,
          },
        ],
      },
    ],
  };
}

export function buildLfgServerResponse(config: LfgConfig) {
  return {
    type: 4,
    data: {
      content: "Choose which server your LFG post is for.",
      flags: 64,
      components: chunk(config.serverOptions, 5).map((serverOptions) => ({
        type: 1,
        components: serverOptions.map((option) => ({
          type: 2,
          custom_id: `lfg:server:${option.id}`,
          label: option.label,
          emoji: option.emoji ? { name: option.emoji } : undefined,
          style: 2,
        })),
      })),
    },
  };
}

export function buildLfgPostModal(serverId: string) {
  return {
    type: 9,
    data: {
      custom_id: `lfg:modal:${serverId}`,
      title: "Create LFG Post",
      components: [
        inputRow("when_play", "When do you play?", true, 100),
        inputRow("looking_for", "Looking for?", true, 100),
        inputRow("extra_info", "Extra info", false, 500),
      ],
    },
  };
}

export function buildLfgPostMessage(post: LfgPost) {
  const closed = !post.active;
  const serverEmoji =
    post.serverLabel === "Namalsk"
      ? "🧊"
      : post.serverLabel === "Chernarus"
        ? "🌲"
        : "🔁";

  return {
    embeds: [
      {
        title: "🎮 Looking For Gamers",
        color: closed ? 0xed4245 : 0x57f287,
        fields: [
          {
            name: `${serverEmoji} Server`,
            value: post.serverLabel,
            inline: false,
          },
          { name: "🕒 When", value: post.whenPlay, inline: false },
          { name: "👥 Looking for", value: post.lookingFor, inline: false },
          {
            name: "📝 Info",
            value: truncateField(post.extraInfo || "No extra info provided."),
            inline: false,
          },
          { name: "👤 Posted by", value: `<@${post.ownerId}>`, inline: false },
          { name: "📌 Status", value: closed ? "Closed" : "Open", inline: false },
        ],
        timestamp: new Date(post.createdAtMs).toISOString(),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            custom_id: `lfg:interested:${post.id}`,
            label: "I'm Interested",
            emoji: { name: "✅" },
            style: 3,
            disabled: closed,
          },
          {
            type: 2,
            custom_id: `lfg:close:${post.id}`,
            label: "Close Post",
            emoji: { name: "❌" },
            style: 4,
            disabled: closed,
          },
        ],
      },
    ],
  };
}

export function buildLfgDmMessage(
  interestedUserId: string,
  interestedUserDisplayName: string,
  post: LfgPost,
) {
  return {
    content: [
      "🔥 **Someone is interested in your LFG post!**",
      "",
      `User: <@${interestedUserId}> (${interestedUserDisplayName})`,
      `Server: **${post.serverLabel}**`,
      `Looking for: ${post.lookingFor}`,
      "",
      "You can DM them directly or add them as a Discord friend.",
    ].join("\n"),
    allowed_mentions: { users: [interestedUserId] },
  };
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
