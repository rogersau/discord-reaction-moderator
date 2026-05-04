export class AdminApiInputError extends Error {}

export async function parseJsonBody<T>(
  request: Request,
  parse: (body: unknown) => T,
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
  try {
    return { ok: true, value: parse(await request.json()) };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof AdminApiInputError) {
      return {
        ok: false,
        response: Response.json({ error: error.message || "Invalid JSON body" }, { status: 400 }),
      };
    }

    throw error;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AdminApiInputError(`Missing ${fieldName}`);
  }

  return value;
}

export function asNullableString(value: unknown, fieldName: string): string | null {
  if (value === null) {
    return null;
  }

  return asRequiredString(value, fieldName);
}

export function asOptionalNullableString(value: unknown, fieldName: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = asRequiredString(value, fieldName).trim();
  return normalized.length > 0 ? normalized : null;
}

export function asBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new AdminApiInputError(`Missing ${fieldName}`);
  }

  return value;
}

export function parseBlocklistMutationBody(body: unknown): {
  guildId: string;
  emoji: string;
  action: "add" | "remove";
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const guildId = asRequiredString(body.guildId, "guildId");
  const emoji = asRequiredString(body.emoji, "emoji");
  const action = asRequiredString(body.action, "action");

  if (action !== "add" && action !== "remove") {
    throw new AdminApiInputError("Invalid action. Use 'add' or 'remove'");
  }

  return { guildId, emoji, action };
}

export function parseTimedRoleMutationBody(body: unknown): {
  guildId: string;
  userId: string;
  roleId: string;
  action: "add" | "remove";
  duration?: string;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const guildId = asRequiredString(body.guildId, "guildId");
  const userId = asRequiredString(body.userId, "userId");
  const roleId = asRequiredString(body.roleId, "roleId");
  const action = asRequiredString(body.action, "action");

  if (action !== "add" && action !== "remove") {
    throw new AdminApiInputError("Invalid action. Use 'add' or 'remove'");
  }

  if (action === "add") {
    if (!body.duration || typeof body.duration !== "string" || body.duration.length === 0) {
      throw new AdminApiInputError("Missing or invalid duration for timed role add");
    }
    return { guildId, userId, roleId, action, duration: body.duration };
  }

  return { guildId, userId, roleId, action };
}

export function parseGuildNotificationChannelBody(body: unknown): {
  guildId: string;
  notificationChannelId: string | null;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    notificationChannelId: asOptionalNullableString(
      body.notificationChannelId,
      "notificationChannelId",
    ),
  };
}

export function parseNewMemberTimedRoleConfigBody(body: unknown): {
  guildId: string;
  roleId: string | null;
  duration: string | null;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    roleId: asOptionalNullableString(body.roleId, "roleId"),
    duration: asOptionalNullableString(body.duration, "duration"),
  };
}

export function parseAppConfigMutation(body: unknown): {
  key: string;
  value: string;
} {
  if (
    !isRecord(body) ||
    typeof body.key !== "string" ||
    body.key.length === 0 ||
    typeof body.value !== "string"
  ) {
    throw new AdminApiInputError("Missing app config key or value");
  }

  return {
    key: body.key,
    value: body.value,
  };
}

export function parseMarketplaceConfigBody(body: unknown): {
  guildId: string;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
  logChannelId: string | null;
  serverOptions: Array<{ id: string; label: string; emoji: string | null }>;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const serverOptions = body.serverOptions;
  if (!Array.isArray(serverOptions) || serverOptions.length === 0 || serverOptions.length > 25) {
    throw new AdminApiInputError("Add between 1 and 25 marketplace servers.");
  }

  const seenIds = new Set<string>();
  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    noticeChannelId: asOptionalNullableString(body.noticeChannelId, "noticeChannelId"),
    noticeMessageId: asOptionalNullableString(body.noticeMessageId, "noticeMessageId"),
    logChannelId: asOptionalNullableString(body.logChannelId, "logChannelId"),
    serverOptions: serverOptions.map((option, index) => {
      if (!isRecord(option)) {
        throw new AdminApiInputError(`Invalid serverOptions[${index}]`);
      }
      const id = asRequiredString(option.id, `serverOptions[${index}].id`).trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
        throw new AdminApiInputError(`Invalid serverOptions[${index}].id`);
      }
      if (seenIds.has(id)) {
        throw new AdminApiInputError(`Duplicate serverOptions[${index}].id`);
      }
      seenIds.add(id);
      return {
        id,
        label: asRequiredString(option.label, `serverOptions[${index}].label`).trim(),
        emoji: asOptionalNullableString(option.emoji, `serverOptions[${index}].emoji`),
      };
    }),
  };
}

export function parseMarketplaceClosePostBody(body: unknown): {
  guildId: string;
  postId: string;
  closedByUserId: string;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
  };
}

export function parseLfgConfigBody(body: unknown): {
  guildId: string;
  noticeChannelId: string | null;
  noticeMessageId: string | null;
  serverOptions: Array<{ id: string; label: string; emoji: string | null }>;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  const serverOptions = body.serverOptions;
  if (!Array.isArray(serverOptions) || serverOptions.length === 0 || serverOptions.length > 25) {
    throw new AdminApiInputError("Add between 1 and 25 LFG servers.");
  }

  const seenIds = new Set<string>();
  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    noticeChannelId: asOptionalNullableString(body.noticeChannelId, "noticeChannelId"),
    noticeMessageId: asOptionalNullableString(body.noticeMessageId, "noticeMessageId"),
    serverOptions: serverOptions.map((option, index) => {
      if (!isRecord(option)) {
        throw new AdminApiInputError(`Invalid serverOptions[${index}]`);
      }
      const id = asRequiredString(option.id, `serverOptions[${index}].id`).trim();
      if (!/^[a-z0-9_-]{1,32}$/.test(id)) {
        throw new AdminApiInputError(`Invalid serverOptions[${index}].id`);
      }
      if (seenIds.has(id)) {
        throw new AdminApiInputError(`Duplicate serverOptions[${index}].id`);
      }
      seenIds.add(id);
      return {
        id,
        label: asRequiredString(option.label, `serverOptions[${index}].label`).trim(),
        emoji: asOptionalNullableString(option.emoji, `serverOptions[${index}].emoji`),
      };
    }),
  };
}

export function parseLfgClosePostBody(body: unknown): {
  guildId: string;
  postId: string;
  closedByUserId: string;
} {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    postId: asRequiredString(body.postId, "postId"),
    closedByUserId: asRequiredString(body.closedByUserId, "closedByUserId"),
  };
}
