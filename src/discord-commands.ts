import type { FeatureFlags } from "./runtime/features";

const ALL_SLASH_COMMAND_DEFINITIONS = [
  {
    name: "lfg",
    description: "Manage the Looking For Gamers noticeboard",
    options: [
      {
        type: 1,
        name: "setup",
        description: "Post or reset the LFG noticeboard in this channel",
      },
    ],
  },
  {
    name: "blocklist",
    description: "Manage this server's blocked emoji list",
    options: [
      {
        type: 1,
        name: "add",
        description: "Block an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to block", required: true }],
      },
      {
        type: 1,
        name: "remove",
        description: "Unblock an emoji in this server",
        options: [{ type: 3, name: "emoji", description: "Emoji to unblock", required: true }],
      },
      {
        type: 1,
        name: "list",
        description: "List the emojis blocked in this server",
      },
    ],
  },
  {
    name: "timedrole",
    description: "Manage timed role assignments in this server",
    options: [
      {
        type: 1,
        name: "add",
        description: "Assign a role to a user for a limited duration",
        options: [
          { type: 6, name: "user", description: "User to assign the role to", required: true },
          { type: 8, name: "role", description: "Role to assign", required: true },
          {
            type: 3,
            name: "duration",
            description: "How long to keep the role (for example 1h, 1w, 1m)",
            required: true,
          },
        ],
      },
      {
        type: 1,
        name: "remove",
        description: "Remove a timed role assignment from a user",
        options: [
          { type: 6, name: "user", description: "User to remove the role from", required: true },
          { type: 8, name: "role", description: "Role to remove", required: true },
        ],
      },
      {
        type: 1,
        name: "list",
        description: "List timed role assignments in this server",
      },
    ],
  },
  {
    name: "marketplace",
    description: "Manage this server's marketplace",
    options: [
      {
        type: 1,
        name: "setup",
        description: "Post or reset the marketplace noticeboard in this channel",
      },
      {
        type: 1,
        name: "logs",
        description: "View recent marketplace business logs",
        options: [
          {
            type: 4,
            name: "amount",
            description: "Number of logs to show (1-20)",
            required: false,
            min_value: 1,
            max_value: 20,
          },
        ],
      },
    ],
  },
];

export function getSlashCommandDefinitions(features: FeatureFlags) {
  return ALL_SLASH_COMMAND_DEFINITIONS.filter((command) => {
    switch (command.name) {
      case "lfg":
        return features.lfg;
      case "marketplace":
        return features.marketplace;
      case "blocklist":
        return features.blocklist;
      case "timedrole":
        return features.timedRoles;
      default:
        return true;
    }
  });
}

/** @deprecated Use getSlashCommandDefinitions instead. */
export const SLASH_COMMAND_DEFINITIONS = ALL_SLASH_COMMAND_DEFINITIONS;
