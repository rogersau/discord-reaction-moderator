import { createServer, type IncomingMessage, type Server } from "node:http";

interface NodeRuntimeServerOptions {
  port: number;
  app: {
    fetch(request: Request): Promise<Response>;
  };
}

export async function startNodeRuntimeServer(
  options: NodeRuntimeServerOptions
): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      const request = new Request(buildRequestUrl(req), {
        method: req.method,
        headers: toHeaders(req),
        body: await readRequestBody(req),
      });
      const response = await options.app.fetch(request);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (req.method === "HEAD") {
        res.end();
        return;
      }

      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      console.error("Node runtime HTTP request failed", error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port, "0.0.0.0");
  });

  return server;
}

function buildRequestUrl(request: IncomingMessage): string {
  const host = request.headers.host ?? "127.0.0.1";
  return `http://${host}${request.url ?? "/"}`;
}

function toHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }
  return headers;
}

async function readRequestBody(
  request: IncomingMessage
): Promise<ArrayBuffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
}
