import type { AdminSessionPayload } from "./admin-types";

const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const encoder = new TextEncoder();

export const ADMIN_SESSION_COOKIE_NAME = "admin_session";

export async function createAdminSessionCookie(
  secret: string,
  options?: {
    secure?: boolean;
  },
  nowMs = Date.now()
): Promise<string> {
  if (!secret) {
    throw new Error("ADMIN_SESSION_SECRET is required to create admin session cookies.");
  }
  
  const payload: AdminSessionPayload = {
    exp: nowMs + ADMIN_SESSION_TTL_SECONDS * 1000,
  };
  const encodedPayload = encodeURIComponent(JSON.stringify(payload));
  const signature = await signValue(secret, encodedPayload);

  const attributes = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodedPayload}.${signature}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${ADMIN_SESSION_TTL_SECONDS}`,
  ];
  if (options?.secure) {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export async function isValidAdminPassword(
  actual: unknown,
  expected: string
): Promise<boolean> {
  if (typeof actual !== "string") {
    return false;
  }

  const [actualDigest, expectedDigest] = await Promise.all([
    digestValue(actual),
    digestValue(expected),
  ]);

  return timingSafeEqualFixedLengthHex(actualDigest, expectedDigest);
}

export async function hasValidAdminSession(
  request: Request,
  secret: string,
  nowMs = Date.now()
): Promise<boolean> {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return false;
  }

  const sessionValue = readCookieValue(cookieHeader, ADMIN_SESSION_COOKIE_NAME);
  if (!sessionValue) {
    return false;
  }

  const separatorIndex = sessionValue.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return false;
  }

  const encodedPayload = sessionValue.slice(0, separatorIndex);
  const actualSignature = sessionValue.slice(separatorIndex + 1);
  const expectedSignature = await signValue(secret, encodedPayload);

  if (!timingSafeEqualFixedLengthHex(actualSignature, expectedSignature)) {
    return false;
  }

  try {
    const payload = JSON.parse(
      decodeURIComponent(encodedPayload)
    ) as Partial<AdminSessionPayload>;

    return typeof payload.exp === "number" && Number.isFinite(payload.exp) && payload.exp > nowMs;
  } catch {
    return false;
  }
}

async function signValue(secret: string, value: string): Promise<string> {
  const subtle = crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable in this runtime.");
  }

  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await subtle.sign("HMAC", key, encoder.encode(value));

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readCookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const trimmedPart = part.trim();
    const separatorIndex = trimmedPart.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const cookieName = trimmedPart.slice(0, separatorIndex);
    if (cookieName === name) {
      return trimmedPart.slice(separatorIndex + 1);
    }
  }

  return undefined;
}

// This helper is only used with fixed-length hex digests/signatures generated above.
// It is not intended to be a general-purpose constant-time string comparison.
function timingSafeEqualFixedLengthHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}

async function digestValue(value: string): Promise<string> {
  const subtle = crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto API is unavailable in this runtime.");
  }

  const digest = await subtle.digest("SHA-256", encoder.encode(value));

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
