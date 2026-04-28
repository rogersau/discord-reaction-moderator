export const DISCORD_API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: string
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

export async function discordRequest(
  url: string,
  method: string,
  botToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    method,
    headers: {
      Authorization: `Bot ${botToken}`,
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(`Discord API error: ${response.status} ${details}`, response.status, details);
  }

  return response;
}

export async function parseDiscordJson<T>(response: Response, message: string): Promise<T> {
  if (!response.ok) {
    const details = await response.text().catch(() => "Unknown error");
    throw new DiscordApiError(message, response.status, details);
  }

  return response.json();
}

export async function discordGetJson<T>(url: string, botToken: string): Promise<T> {
  const response = await discordRequest(url, "GET", botToken);
  return parseDiscordJson<T>(response, `Discord request failed: GET ${url}`);
}
