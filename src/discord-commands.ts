export const SLASH_COMMAND_DEFINITIONS = [
  {
    name: "blocklist",
    description: "Manage this server's blocked emoji list",
    options: [
      {
        type: 1,
        name: "add",
        description: "Add an emoji to the blocked list",
        options: [{ type: 3, name: "emoji", description: "Emoji to block" }],
      },
      {
        type: 1,
        name: "remove",
        description: "Remove an emoji from the blocked list",
        options: [{ type: 3, name: "emoji", description: "Emoji to unblock" }],
      },
    ],
  },
];
