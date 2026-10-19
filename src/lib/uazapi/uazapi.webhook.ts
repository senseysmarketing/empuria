const SECRET_KEYS = /token|secret|password|api.?key|authorization/i;

export function equalSecret(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export function confirmedInstanceWebhook(
  response: unknown,
  expectedUrl: string,
  requiredEvents: readonly string[],
) {
  const record =
    response && typeof response === "object" ? (response as Record<string, unknown>) : null;
  const hooks = Array.isArray(response)
    ? response
    : Array.isArray(record?.webhooks)
      ? record.webhooks
      : Array.isArray(record?.data)
        ? record.data
        : record?.url
          ? [record]
          : [];
  return (
    (hooks as Record<string, unknown>[]).find(
      (hook) =>
        hook.url === expectedUrl &&
        hook.enabled === true &&
        requiredEvents.every((event) => Array.isArray(hook.events) && hook.events.includes(event)),
    ) ?? null
  );
}

export function redactUazapiValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUazapiValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SECRET_KEYS.test(key))
        .map(([key, item]) => [key, redactUazapiValue(item)]),
    );
  }
  if (typeof value === "string") {
    return value.replace(/([?&](?:token|secret|admintoken|api_key)=)[^&#\s]+/gi, "$1[redacted]");
  }
  return value;
}

export function uazapiEventType(payload: Record<string, unknown>, hasMessage: boolean) {
  const direct = [payload.EventType, payload.event, payload.event_type, payload.type].find(
    (value) =>
      typeof value === "string" &&
      ["connection", "messages", "messages_update"].includes(value.toLowerCase()),
  );
  return typeof direct === "string" ? direct.toLowerCase() : hasMessage ? "messages" : "unknown";
}

export function belongsToUazapiInstance(
  payload: Record<string, unknown>,
  expected: { token: string | null; id: string | null; name: string; baseUrl: string },
) {
  if (!expected.token) return false;
  if (typeof payload.token === "string" && !equalSecret(payload.token, expected.token))
    return false;
  if (typeof payload.instanceName === "string" && payload.instanceName !== expected.name)
    return false;
  if (
    typeof payload.BaseUrl === "string" &&
    payload.BaseUrl.replace(/\/+$/, "") !== expected.baseUrl
  )
    return false;
  const instance = payload.instance;
  if (instance && typeof instance === "object") {
    const record = instance as Record<string, unknown>;
    if (typeof record.name === "string" && record.name !== expected.name) return false;
    if (expected.id && typeof record.id === "string" && record.id !== expected.id) return false;
  }
  return true;
}
