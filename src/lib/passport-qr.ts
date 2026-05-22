const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildPassportQrPayload(userId: string) {
  return `empuria:passport:v1:${userId}`;
}

export function parsePassportQrPayload(raw: string): string | null {
  const value = raw.trim();
  const candidates = [
    value,
    value.startsWith("empuria:") ? value.slice("empuria:".length) : value,
    value.startsWith("empuria:passport:v1:")
      ? value.slice("empuria:passport:v1:".length)
      : value,
  ];

  const match = candidates.find((candidate) => UUID_RE.test(candidate));
  return match ? match.toLowerCase() : null;
}
