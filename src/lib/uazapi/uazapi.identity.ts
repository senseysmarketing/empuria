import { parsePhoneNumberFromString } from "libphonenumber-js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function confirmedPhone(value: unknown, server?: unknown): string | null {
  if (typeof value !== "string") return null;
  if (typeof server === "string" && server !== "s.whatsapp.net" && server !== "c.us") return null;
  const raw = value.trim();
  if (/@(lid|g\.us|broadcast)$/i.test(raw)) return null;
  const user = raw.split("@")[0].split(":")[0];
  if (!/^[1-9][0-9]{7,14}$/.test(user)) return null;
  const parsed = parsePhoneNumberFromString(`+${user}`);
  return parsed?.isValid() ? parsed.number.slice(1) : null;
}

/** The connection webhook supplies `owner` as the confirmed PN. A JID can carry a device suffix or be a LID. */
export function extractUazapiPhone(payload: RecordValue): string | null {
  const instance = record(payload.instance);
  const status = record(payload.status);
  const jid = record(status.jid);
  return (
    confirmedPhone(payload.owner) ??
    confirmedPhone(instance.owner) ??
    confirmedPhone(jid.user, jid.server) ??
    confirmedPhone(status.jid) ??
    null
  );
}
