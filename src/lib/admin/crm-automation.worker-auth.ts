export function workerSecretIsValid(headers: Headers, expected: string | undefined) {
  if (!expected) return false;
  const auth = headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null;
  return headers.get("x-cron-secret") === expected || bearer === expected;
}
