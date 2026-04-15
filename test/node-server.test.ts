/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { once } from "node:events";
import { createServer, request } from "node:http";

import { startNodeRuntimeServer } from "../src/runtime/node-server";

test("startNodeRuntimeServer serves /health from the portable runtime", async () => {
  const server = await startNodeRuntimeServer({
    port: 0,
    app: {
      fetch(request: Request) {
        return Promise.resolve(
          new URL(request.url).pathname === "/health"
            ? new Response("OK", { status: 200 })
            : new Response("Not found", { status: 404 })
        );
      },
    },
  });

  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const responseBody = await new Promise<string>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/health", method: "GET" },
        (response) => {
          let body = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () => resolve(body));
        }
      );
      req.on("error", reject);
      req.end();
    });

    assert.equal(responseBody, "OK");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("startNodeRuntimeServer rejects when the port is already in use", async () => {
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");

  const address = blocker.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    await assert.rejects(
      withTimeout(
        startNodeRuntimeServer({
          port,
          app: {
            fetch() {
              return Promise.resolve(new Response("OK", { status: 200 }));
            },
          },
        }),
        100
      ),
      /EADDRINUSE/
    );
  } finally {
    blocker.close();
    await once(blocker, "close");
  }
});

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}
