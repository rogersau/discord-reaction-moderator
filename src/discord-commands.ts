export const SLASH_COMMAND_DEFINITIONS = [
  {
    name: "blocklist",
    description: "Manage this server's blocked emoji list",
    options: [
      {
        type: 1,
        name: "add",
        description: "Block an emoji in this server",
        options: [
          { type: 3, name: "emoji", description: "Emoji to block", required: true },
        ],
      },
      {
        type: 1,
        name: "remove",
        description: "Unblock an emoji in this server",
        options: [
          { type: 3, name: "emoji", description: "Emoji to unblock", required: true },
        ],
      },
    ],
  },
];
