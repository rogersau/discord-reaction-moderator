import type { GatewaySnapshot } from "./contracts";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createCloudflareGatewayClient(gatewayStub: { fetch: FetchLike }) {
  return {
    async start(): Promise<GatewaySnapshot> {
      return readJson<GatewaySnapshot>(
        gatewayStub.fetch("https://gateway-session/start", { method: "POST" }),
      );
    },
    async status(): Promise<GatewaySnapshot> {
      return readJson<GatewaySnapshot>(gatewayStub.fetch("https://gateway-session/status"));
    },
  };
}

async function validateResponse(responsePromise: Promise<Response>): Promise<Response> {
  const response = await responsePromise;
  if (!response.ok) {
    throw new Error(
      `Cloudflare gateway request failed: ${response.status} ${await response.text()}`,
    );
  }
  return response;
}

async function readJson<T>(responsePromise: Promise<Response>): Promise<T> {
  const response = await validateResponse(responsePromise);
  return response.json();
}
