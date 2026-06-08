// Server-only Wise API helper.
// Docs: https://docs.wise.com/api-docs/api-reference/payment-link
// SCA: many write endpoints require 2FA, but payment-links creation works with a regular
// personal/business API token issued in the Wise web UI.

const WISE_API_HOSTS = {
  sandbox: "https://api.sandbox.transferwise.tech",
  live: "https://api.transferwise.com",
} as const;

export type WiseEnvironment = keyof typeof WISE_API_HOSTS;

export type WiseClientOptions = {
  token: string;
  environment: WiseEnvironment;
};

function baseUrl(env: WiseEnvironment) {
  return WISE_API_HOSTS[env] ?? WISE_API_HOSTS.sandbox;
}

async function wiseFetch<T>(
  client: WiseClientOptions,
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string; body: unknown }> {
  const url = `${baseUrl(client.environment)}${path}`;
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${client.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : "network_error", body: null };
  }
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!response.ok) {
    const error =
      (typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as Record<string, unknown>).message)
        : null) ?? `Wise API ${response.status}`;
    return { ok: false, status: response.status, error, body: parsed };
  }
  return { ok: true, status: response.status, data: parsed as T };
}

export type WiseProfile = {
  id: number;
  type: "personal" | "business";
  fullName?: string;
  details?: Record<string, unknown>;
};

export async function listWiseProfiles(client: WiseClientOptions) {
  return wiseFetch<WiseProfile[]>(client, "/v2/profiles", { method: "GET" });
}

export type WisePaymentLinkPayload = {
  amount: number; // major units, e.g. 199.50
  currency: string; // ISO 4217, e.g. "EUR"
  description?: string;
  reference?: string; // shown to payer, max 35 chars
  redirectUrl?: string;
  metadata?: Record<string, string>;
};

export type WisePaymentLinkResponse = {
  id: string;
  status: string;
  paymentUrl?: string;
  url?: string;
  amount?: number;
  currency?: string;
  reference?: string;
  description?: string;
  createdAt?: string;
};

/**
 * Creates a Wise Payment Link for the given profile.
 * Wise's modern endpoint is POST /v3/profiles/{profileId}/payment-links.
 */
export async function createWisePaymentLink(
  client: WiseClientOptions,
  profileId: string | number,
  payload: WisePaymentLinkPayload,
) {
  const body = {
    amount: { value: payload.amount, currency: payload.currency },
    description: payload.description ?? null,
    reference: payload.reference ?? null,
    redirectUrl: payload.redirectUrl ?? null,
    metadata: payload.metadata ?? {},
  };
  return wiseFetch<WisePaymentLinkResponse>(
    client,
    `/v3/profiles/${profileId}/payment-links`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

/**
 * Fetch the current status of a Wise payment link.
 */
export async function getWisePaymentLink(
  client: WiseClientOptions,
  profileId: string | number,
  linkId: string,
) {
  return wiseFetch<WisePaymentLinkResponse>(
    client,
    `/v3/profiles/${profileId}/payment-links/${linkId}`,
    { method: "GET" },
  );
}

/**
 * Verify a Wise webhook RSA-SHA256 signature.
 * The public key must be in PEM format. Wise sends the signature in the
 * `X-Signature-SHA256` header (base64). The signed payload is the raw body.
 */
export async function verifyWiseWebhookSignature(args: {
  publicKeyPem: string;
  signatureBase64: string;
  rawBody: string;
}): Promise<boolean> {
  if (!args.publicKeyPem || !args.signatureBase64) return false;
  const pem = args.publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = Uint8Array.from(atob(args.signatureBase64), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  try {
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      keyBytes,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signatureBytes,
      new TextEncoder().encode(args.rawBody),
    );
  } catch {
    return false;
  }
}
