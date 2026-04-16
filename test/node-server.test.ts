/// <reference types="node/assert" />
/// <reference types="node/assert/strict" />

import assert from "node:assert/strict";
// @ts-ignore -- Runtime tests compile under tsconfig.tests.json.
import test from "node:test";

import { once } from "node:events";
import { createServer, request, type Server } from "node:http";

import { createRuntimeApp } from "../src/runtime/app";
import { startNodeRuntimeServer } from "../src/runtime/node-server";
import type { GatewayController, RuntimeStore } from "../src/runtime/contracts";

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
    const response = await requestServer(server, "/health");
    assert.equal(response.body, "OK");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("startNodeRuntimeServer serves the admin login page and protects /admin", async () => {
  const app = createRuntimeApp({
    discordPublicKey: "a".repeat(64),
    discordBotToken: "bot-token",
    adminUiPassword: "let-me-in",
    adminSessionSecret: "session-secret",
    verifyDiscordRequest: async () => true,
    store: {} as RuntimeStore,
    gateway: {} as GatewayController,
  });

  const server = await startNodeRuntimeServer({
    port: 0,
    app,
  });

  try {
    const loginResponse = await requestServer(server, "/admin/login");
    assert.equal(loginResponse.statusCode, 200);
    assert.equal(loginResponse.headers["content-type"], "text/html; charset=utf-8");
    assert.match(loginResponse.body, /admin-root/);

    const unauthenticatedAdminResponse = await requestServer(server, "/admin");
    assert.equal(unauthenticatedAdminResponse.statusCode, 302);
    assert.equal(unauthenticatedAdminResponse.headers.location, "/admin/login");
    assert.equal(unauthenticatedAdminResponse.body, "");

    const loginSubmissionResponse = await requestServer(server, "/admin/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=let-me-in",
    });
    assert.equal(loginSubmissionResponse.statusCode, 302);
    assert.equal(loginSubmissionResponse.headers.location, "/admin");
    const setCookieHeader = loginSubmissionResponse.headers["set-cookie"];
    const sessionCookie = Array.isArray(setCookieHeader)
      ? setCookieHeader[0]
      : setCookieHeader;
    assert.match(sessionCookie ?? "", /admin_session=/);

    const authenticatedAdminResponse = await requestServer(server, "/admin", {
      headers: { cookie: sessionCookie ?? "" },
    });
    assert.equal(authenticatedAdminResponse.statusCode, 200);
    assert.equal(authenticatedAdminResponse.headers["content-type"], "text/html; charset=utf-8");
    assert.match(authenticatedAdminResponse.body, /data-authenticated="true"/);
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

async function requestServer(
  server: Server,
  path: string,
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: options?.method ?? "GET",
        headers: options?.headers,
      },
      (response) => {
        let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () =>
        resolve({
          statusCode: response.statusCode ?? 0,
          headers: response.headers,
          body,
        })
      );
      }
    );
    req.on("error", reject);
    if (options?.body) {
      req.write(options.body);
    }
    req.end();
  });
}
