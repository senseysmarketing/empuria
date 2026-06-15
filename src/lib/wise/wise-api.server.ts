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

export type WiseBalance = {
  id: number | string;
  currency: string;
  type?: string;
  name?: string | null;
  amount?: { value?: number; currency?: string } | null;
};

export async function listWiseBalances(client: WiseClientOptions, profileId: string | number) {
  return wiseFetch<WiseBalance[]>(
    client,
    `/v4/profiles/${profileId}/balances?types=STANDARD`,
    { method: "GET" },
  );
}

export type WiseAccountDetail = {
  id?: number | string;
  currency?: string;
  bankDetails?: {
    iban?: string | null;
    bic?: string | null;
    swift?: string | null;
    accountNumber?: string | null;
    bankName?: string | null;
    bankAddress?: { addressFirstLine?: string | null; city?: string | null; country?: string | null; postCode?: string | null } | null;
    accountHolderName?: string | null;
    address?: { addressFirstLine?: string | null; city?: string | null; country?: string | null; postCode?: string | null } | null;
  } | null;
  title?: string | null;
};

export async function listWiseAccountDetails(client: WiseClientOptions, profileId: string | number) {
  return wiseFetch<WiseAccountDetail[]>(
    client,
    `/v1/profiles/${profileId}/account-details`,
    { method: "GET" },
  );
}


export type WisePaymentRequestPayload = {
  amount: number; // major units, e.g. 199.50
  currency: string; // ISO 4217
  description?: string;
  reference?: string; // shown to payer/statement, max 35 chars
  balanceId?: string | number | null;
  payerEmailMessage?: string;
  metadata?: Record<string, string>;
};

export type WisePaymentRequestResponse = {
  id: string;
  status?: string;
  link?: string;
  paymentUrl?: string;
  url?: string;
  amount?: { value?: number; currency?: string } | number;
  currency?: string;
  reference?: string;
  description?: string;
  createdAt?: string;
};

/**
 * Creates a Wise Payment Request (hosted checkout link). Tries the modern v2
 * endpoint first; falls back to alternate paths some Business accounts use.
 * Returns the wiseFetch error envelope so callers can decide to fall back.
 */
export async function createWisePaymentRequest(
  client: WiseClientOptions,
  profileId: string | number,
  payload: WisePaymentRequestPayload,
) {
  const body: Record<string, unknown> = {
    amount: { value: payload.amount, currency: payload.currency },
    description: payload.description ?? null,
    reference: payload.reference ?? null,
    payerEmailMessage: payload.payerEmailMessage ?? null,
    metadata: payload.metadata ?? {},
  };
  if (payload.balanceId) body.balanceId = payload.balanceId;

  const paths = [
    `/v2/profiles/${profileId}/payment-requests`,
    `/v1/profiles/${profileId}/payment-requests`,
    `/v2/business/${profileId}/payment-requests`,
  ];
  let lastError: { status: number; error: string; body: unknown } | null = null;
  for (const path of paths) {
    const res = await wiseFetch<WisePaymentRequestResponse>(client, path, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (res.ok) return res;
    lastError = { status: res.status, error: res.error, body: res.body };
    // Only keep trying on 404 (path missing). Other errors stop the cascade.
    if (res.status !== 404) break;
  }
  return {
    ok: false as const,
    status: lastError?.status ?? 0,
    error: lastError?.error ?? "unknown",
    body: lastError?.body,
  };
}

export async function getWisePaymentRequest(
  client: WiseClientOptions,
  profileId: string | number,
  id: string,
) {
  const paths = [
    `/v2/profiles/${profileId}/payment-requests/${id}`,
    `/v1/profiles/${profileId}/payment-requests/${id}`,
    `/v2/business/${profileId}/payment-requests/${id}`,
  ];
  let lastError: { status: number; error: string; body: unknown } | null = null;
  for (const path of paths) {
    const res = await wiseFetch<WisePaymentRequestResponse>(client, path, { method: "GET" });
    if (res.ok) return res;
    lastError = { status: res.status, error: res.error, body: res.body };
    if (res.status !== 404) break;
  }
  return {
    ok: false as const,
    status: lastError?.status ?? 0,
    error: lastError?.error ?? "unknown",
    body: lastError?.body,
  };
}

export function pickHostedUrl(
  data: WisePaymentRequestResponse | undefined | null,
): string | null {
  if (!data) return null;
  return (
    (data.link as string | undefined) ??
    (data.paymentUrl as string | undefined) ??
    (data.url as string | undefined) ??
    null
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
    const keyBuf = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
    const sigBuf = signatureBytes.buffer.slice(signatureBytes.byteOffset, signatureBytes.byteOffset + signatureBytes.byteLength) as ArrayBuffer;
    const bodyEnc = new TextEncoder().encode(args.rawBody);
    const bodyBuf = bodyEnc.buffer.slice(bodyEnc.byteOffset, bodyEnc.byteOffset + bodyEnc.byteLength) as ArrayBuffer;
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      keyBuf,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return await globalThis.crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sigBuf, bodyBuf);
  } catch {
    return false;
  }
}
