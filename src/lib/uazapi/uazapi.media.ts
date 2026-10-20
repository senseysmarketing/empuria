export type InboxMediaKind = "image" | "video" | "audio" | "document";

export const INBOX_MEDIA_BUCKET = "crm-inbox-media";
export const MAX_INBOX_MEDIA_BYTES = 16 * 1024 * 1024;

export function mediaKind(messageType: string | null | undefined): InboxMediaKind | null {
  const type = (messageType ?? "").toLowerCase();
  if (type.includes("image") || type.includes("sticker")) return "image";
  if (type.includes("video")) return "video";
  if (type.includes("audio") || type === "ptt" || type === "myaudio") return "audio";
  if (type.includes("document")) return "document";
  return null;
}

export function allowedMediaMime(kind: InboxMediaKind, mime: string): boolean {
  const normalized = mime.toLowerCase().split(";")[0].trim();
  const accepted: Record<InboxMediaKind, string[]> = {
    image: ["image/jpeg", "image/png", "image/webp"],
    video: ["video/mp4"],
    audio: ["audio/ogg", "audio/mpeg", "audio/mp4"],
    document: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
    ],
  };
  return accepted[kind].includes(normalized);
}

export function validMediaName(name: string, mime: string): boolean {
  if (
    !name ||
    name.length > 180 ||
    /[\\/]/.test(name) ||
    [...name].some((char) => char.charCodeAt(0) < 32)
  )
    return false;
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const extensions: Record<string, string[]> = {
    "image/jpeg": ["jpg", "jpeg"],
    "image/png": ["png"],
    "image/webp": ["webp"],
    "video/mp4": ["mp4"],
    "audio/ogg": ["ogg"],
    "audio/mpeg": ["mp3"],
    "audio/mp4": ["m4a"],
    "application/pdf": ["pdf"],
    "text/plain": ["txt"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ["docx"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ["xlsx"],
  };
  return Boolean(extension && extensions[mime.toLowerCase()]?.includes(extension));
}

export function matchesMediaSignature(mime: string, bytes: Uint8Array): boolean {
  const type = mime.toLowerCase().split(";")[0].trim();
  const head = (n: number) => String.fromCharCode(...bytes.slice(0, n));
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8;
  if (type === "image/png") return bytes[0] === 0x89 && head(4).slice(1) === "PNG";
  if (type === "image/webp")
    return head(4) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (type === "video/mp4" || type === "audio/mp4")
    return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  if (type === "audio/ogg") return head(4) === "OggS";
  if (type === "audio/mpeg")
    return head(3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (type === "application/pdf") return head(4) === "%PDF";
  if (type.includes("openxmlformats")) return head(2) === "PK";
  if (type === "text/plain") return !bytes.slice(0, 512).includes(0);
  return false;
}

/** Never fetch arbitrary network destinations returned by a provider. */
export function safeUazapiMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (host === "uazapi.com" || host.endsWith(".uazapi.com"))
    );
  } catch {
    return false;
  }
}

export function normalizedReceipt(
  status: string | null | undefined,
): "pending" | "sent" | "delivered" | "read" | "failed" {
  const value = (status ?? "").toLowerCase();
  if (["read", "played"].includes(value)) return "read";
  if (value === "delivered") return "delivered";
  if (["sent", "manual_sent"].includes(value)) return "sent";
  if (["failed", "canceled", "error", "uncertain"].includes(value)) return "failed";
  return "pending";
}
