import {
  createChannelMessage,
  DiscordApiError,
  type GuildTicketResources,
} from "../discord";
import { buildTicketOpenCustomId } from "../tickets";
import type { TicketPanelConfig, TicketQuestion, TicketTypeConfig } from "../types";
import type { RuntimeStores } from "./app-types";
import {
  getCachedGuildEmojis,
  getCachedGuildTicketResources,
  shouldRefreshAdminDiscordCache,
} from "./admin-discord-cache";
import {
  AdminApiInputError,
  asBoolean,
  asNullableString,
  asOptionalNullableString,
  asRequiredString,
  isRecord,
  parseJsonBody,
} from "./admin-api-validation";

const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface TicketPanelAdminOptions {
  stores: RuntimeStores;
  discordBotToken: string;
}

export async function handleTicketPanelAdminRequest(
  request: Request,
  url: URL,
  options: TicketPanelAdminOptions
): Promise<Response | null> {
  if (request.method === "GET" && url.pathname === "/admin/api/tickets/panel") {
    const guildId = url.searchParams.get("guildId");
    if (!guildId) {
      return Response.json({ error: "guildId is required" }, { status: 400 });
    }

    return Response.json({
      panel: await options.stores.tickets.readTicketPanelConfig(guildId),
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel") {
    const parsedBody = await parseJsonBody(request, parseTicketPanelConfig);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    await options.stores.tickets.upsertTicketPanelConfig(parsedBody.value);
    return Response.json({ ok: true, panel: parsedBody.value });
  }

  if (request.method === "GET" && url.pathname === "/admin/api/tickets/resources") {
    const guildId = url.searchParams.get("guildId");
    if (!guildId) {
      return Response.json({ error: "guildId is required" }, { status: 400 });
    }

    const refresh = shouldRefreshAdminDiscordCache(url);
    const [resources, emojis] = await Promise.all([
      getCachedGuildTicketResources(guildId, options.discordBotToken, refresh),
      getCachedGuildEmojis(guildId, options.discordBotToken, refresh).catch(() => []),
    ]);
    return Response.json({
      guildId,
      roles: resources.roles.map(({ id, name }) => ({ id, name })),
      categories: resources.channels
        .filter((channel) => channel.type === 4)
        .map(({ id, name }) => ({ id, name })),
      textChannels: resources.channels
        .filter((channel) => channel.type === 0)
        .map(({ id, name }) => ({ id, name })),
      emojis: emojis
        .filter((emoji) => emoji.id && emoji.name)
        .map((emoji) => ({
          id: emoji.id as string,
          name: emoji.name as string,
          animated: emoji.animated === true,
          available: emoji.available !== false,
        })),
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/api/tickets/panel/publish") {
    const parsedBody = await parseJsonBody(request, parseTicketPanelPublishMutation);
    if (!parsedBody.ok) {
      return parsedBody.response;
    }

    const panel = await options.stores.tickets.readTicketPanelConfig(parsedBody.value.guildId);
    if (!panel) {
      return Response.json({ error: "Ticket panel config not found." }, { status: 404 });
    }

    const resources = await getCachedGuildTicketResources(
      parsedBody.value.guildId,
      options.discordBotToken,
      true
    );
    const missingTargets = getMissingTicketPanelTargets(panel, resources);
    if (missingTargets.length > 0) {
      return Response.json(
        {
          error: `Ticket panel config references missing Discord targets: ${missingTargets.join(", ")}`,
        },
        { status: 400 }
      );
    }

    let panelMessageId: string;
    try {
      panelMessageId = await publishTicketPanel(panel, options.discordBotToken);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof DiscordApiError
              ? error.message
              : "Failed to publish the ticket panel to Discord.",
        },
        { status: 502 }
      );
    }
    await options.stores.tickets.upsertTicketPanelConfig({
      ...panel,
      panelMessageId,
    });
    return Response.json({ ok: true, panelMessageId });
  }

  return null;
}

function parseTicketPanelPublishMutation(body: unknown): { guildId: string } {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
  };
}

function parseTicketPanelConfig(body: unknown): TicketPanelConfig {
  if (!isRecord(body)) {
    throw new AdminApiInputError("Invalid JSON body");
  }

  return {
    guildId: asRequiredString(body.guildId, "guildId"),
    panelChannelId: asRequiredString(body.panelChannelId, "panelChannelId"),
    categoryChannelId: asRequiredString(body.categoryChannelId, "categoryChannelId"),
    transcriptChannelId: asRequiredString(body.transcriptChannelId, "transcriptChannelId"),
    panelEmoji: asOptionalNullableString(body.panelEmoji, "panelEmoji"),
    panelTitle: asOptionalNullableString(body.panelTitle, "panelTitle"),
    panelDescription: asOptionalNullableString(body.panelDescription, "panelDescription"),
    panelFooter: asOptionalNullableString(body.panelFooter, "panelFooter"),
    panelMessageId: asNullableString(body.panelMessageId, "panelMessageId"),
    ticketTypes: parseTicketTypes(body.ticketTypes),
  };
}

function parseTicketTypes(value: unknown): TicketPanelConfig["ticketTypes"] {
  if (!Array.isArray(value)) {
    throw new AdminApiInputError("Missing ticketTypes");
  }

  const seenIds = new Set<string>();
  return value.map((ticketType, index) => {
    if (!isRecord(ticketType)) {
      throw new AdminApiInputError(`Invalid ticketTypes[${index}]`);
    }

    const id = asRequiredString(ticketType.id, `ticketTypes[${index}].id`);
    if (seenIds.has(id)) {
      throw new AdminApiInputError(`Duplicate ticketTypes[${index}].id`);
    }
    seenIds.add(id);

    return {
      id,
      label: asRequiredString(ticketType.label, `ticketTypes[${index}].label`),
      emoji: asNullableString(ticketType.emoji, `ticketTypes[${index}].emoji`),
      buttonStyle: asTicketButtonStyle(ticketType.buttonStyle),
      supportRoleId: asRequiredString(ticketType.supportRoleId, `ticketTypes[${index}].supportRoleId`),
      channelNamePrefix: asRequiredString(ticketType.channelNamePrefix, `ticketTypes[${index}].channelNamePrefix`),
      questions: parseTicketQuestions(ticketType.questions, index),
    };
  });
}

function parseTicketQuestions(
  value: unknown,
  ticketTypeIndex: number
): TicketQuestion[] {
  if (!Array.isArray(value)) {
    throw new AdminApiInputError(`Missing ticketTypes[${ticketTypeIndex}].questions`);
  }
  if (value.length > 5) {
    throw new AdminApiInputError(`ticketTypes[${ticketTypeIndex}].questions cannot exceed 5 entries`);
  }

  return value.map((question, questionIndex) => {
    if (!isRecord(question)) {
      throw new AdminApiInputError(
        `Invalid ticketTypes[${ticketTypeIndex}].questions[${questionIndex}]`
      );
    }

    return {
      id: asRequiredString(question.id, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].id`),
      label: asRequiredString(question.label, `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].label`),
      style: asTicketQuestionStyle(question.style),
      placeholder: asNullableString(
        question.placeholder,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].placeholder`
      ),
      required: asBoolean(
        question.required,
        `ticketTypes[${ticketTypeIndex}].questions[${questionIndex}].required`
      ),
    };
  });
}

function asTicketButtonStyle(value: unknown): TicketTypeConfig["buttonStyle"] {
  if (value !== "primary" && value !== "secondary" && value !== "success" && value !== "danger") {
    throw new AdminApiInputError("Missing buttonStyle");
  }

  return value;
}

function asTicketQuestionStyle(value: unknown): TicketQuestion["style"] {
  if (value !== "short" && value !== "paragraph") {
    throw new AdminApiInputError("Missing style");
  }

  return value;
}

function getMissingTicketPanelTargets(
  panel: TicketPanelConfig,
  resources: GuildTicketResources
): string[] {
  const categoryIds = new Set(
    resources.channels.filter((channel) => channel.type === 4).map((channel) => channel.id)
  );
  const textChannelIds = new Set(
    resources.channels.filter((channel) => channel.type === 0).map((channel) => channel.id)
  );
  const roleIds = new Set(resources.roles.map((role) => role.id));
  const missing: string[] = [];

  if (!textChannelIds.has(panel.panelChannelId)) {
    missing.push(`panelChannelId ${panel.panelChannelId}`);
  }
  if (!categoryIds.has(panel.categoryChannelId)) {
    missing.push(`categoryChannelId ${panel.categoryChannelId}`);
  }
  if (!textChannelIds.has(panel.transcriptChannelId)) {
    missing.push(`transcriptChannelId ${panel.transcriptChannelId}`);
  }

  panel.ticketTypes.forEach((ticketType, index) => {
    if (!roleIds.has(ticketType.supportRoleId)) {
      missing.push(`ticketTypes[${index}].supportRoleId ${ticketType.supportRoleId}`);
    }
  });

  return missing;
}

function buildTicketPanelMessage(panel: TicketPanelConfig) {
  const embed = buildTicketPanelEmbed(panel);

  return {
    content: embed ? "" : "Open a ticket by choosing the option that fits your request.",
    embeds: embed ? [embed] : [],
    components: chunkTicketTypeButtons(panel.ticketTypes).map((row) => ({
      type: 1,
      components: row.map((ticketType) => ({
        type: 2,
        custom_id: buildTicketOpenCustomId(ticketType.id),
        label: ticketType.label,
        style: mapTicketButtonStyle(ticketType.buttonStyle),
        ...(ticketType.emoji ? { emoji: { name: ticketType.emoji } } : {}),
      })),
    })),
  };
}

function buildTicketPanelEmbed(panel: TicketPanelConfig) {
  if (!panel.panelEmoji && !panel.panelTitle && !panel.panelDescription && !panel.panelFooter) {
    return null;
  }

  return {
    color: 0x57f287,
    ...(panel.panelTitle || panel.panelEmoji
      ? { title: formatTicketPanelEmbedTitle(panel.panelEmoji, panel.panelTitle) }
      : {}),
    ...(panel.panelDescription ? { description: panel.panelDescription } : {}),
    ...(panel.panelFooter ? { footer: { text: panel.panelFooter } } : {}),
  };
}

function formatTicketPanelEmbedTitle(
  panelEmoji: string | null,
  panelTitle: string | null
): string {
  const emoji = panelEmoji?.trim();
  const title = panelTitle?.trim();

  if (emoji && title) {
    return `${emoji} ${title}`;
  }

  return emoji || title || "Tickets";
}

function chunkTicketTypeButtons(ticketTypes: TicketTypeConfig[]): TicketTypeConfig[][] {
  const rows: TicketTypeConfig[][] = [];

  for (let index = 0; index < ticketTypes.length; index += 5) {
    rows.push(ticketTypes.slice(index, index + 5));
  }

  return rows;
}

function mapTicketButtonStyle(style: TicketTypeConfig["buttonStyle"]): 1 | 2 | 3 | 4 {
  switch (style) {
    case "secondary":
      return 2;
    case "success":
      return 3;
    case "danger":
      return 4;
    case "primary":
    default:
      return 1;
  }
}

async function publishTicketPanel(
  panel: TicketPanelConfig,
  discordBotToken: string
): Promise<string> {
  const message = buildTicketPanelMessage(panel);

  if (panel.panelMessageId) {
    try {
      const refreshed = await updateDiscordChannelMessage(
        panel.panelChannelId,
        panel.panelMessageId,
        message,
        discordBotToken
      );
      return refreshed.id;
    } catch (error) {
      if (!(error instanceof DiscordApiError) || error.status !== 404) {
        throw error;
      }
    }
  }

  const created = await createChannelMessage(panel.panelChannelId, message, discordBotToken);
  return created.id;
}

async function updateDiscordChannelMessage(
  channelId: string,
  messageId: string,
  body: Record<string, unknown>,
  discordBotToken: string
): Promise<{ id: string }> {
  const response = await fetch(
    `${DISCORD_API_BASE}/channels/${channelId}/messages/${messageId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${discordBotToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  return parseDiscordJsonResponse(response, "Failed to update channel message");
}

async function parseDiscordJsonResponse<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const details = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(`${message}: ${response.status} ${details}`, response.status, details);
  }

  return response.json() as Promise<T>;
}
