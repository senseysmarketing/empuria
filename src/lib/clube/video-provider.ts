// Helpers para detectar e normalizar links de vídeo (Google Drive, YouTube, Vimeo, arquivo direto)

export type VideoProvider = "google_drive" | "youtube" | "vimeo" | "direct";

export type BuiltVideo = {
  provider: VideoProvider | null;
  file_id: string | null;
  embed_url: string | null;
  source_url: string | null;
};

export function extractGoogleDriveFileId(url: string): string | null {
  if (!url) return null;
  // /file/d/{id}/
  const m1 = url.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m1) return m1[1];
  // ?id={id} or &id={id}
  const m2 = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m2) return m2[1];
  // /open?id=
  const m3 = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m3) return m3[1];
  return null;
}

export function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  return m?.[1] ?? null;
}

export function extractVimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  return m?.[1] ?? null;
}

export function detectVideoProvider(url: string): VideoProvider | null {
  if (!url) return null;
  if (/drive\.google\.com|docs\.google\.com/.test(url)) return "google_drive";
  if (/youtube\.com|youtu\.be/.test(url)) return "youtube";
  if (/vimeo\.com/.test(url)) return "vimeo";
  if (/^https?:\/\/.+\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) return "direct";
  return null;
}

export function buildVideoFromUrl(rawUrl: string | null | undefined): BuiltVideo {
  const url = (rawUrl ?? "").trim();
  if (!url) {
    return { provider: null, file_id: null, embed_url: null, source_url: null };
  }
  const provider = detectVideoProvider(url);
  if (provider === "google_drive") {
    const id = extractGoogleDriveFileId(url);
    if (!id) {
      throw new Error("Link do Google Drive inválido. Use um link de arquivo (file/d/.../view).");
    }
    return {
      provider: "google_drive",
      file_id: id,
      embed_url: `https://drive.google.com/file/d/${id}/preview`,
      source_url: url,
    };
  }
  if (provider === "youtube") {
    const id = extractYouTubeId(url);
    return {
      provider: "youtube",
      file_id: id,
      embed_url: id ? `https://www.youtube.com/embed/${id}` : null,
      source_url: url,
    };
  }
  if (provider === "vimeo") {
    const id = extractVimeoId(url);
    return {
      provider: "vimeo",
      file_id: id,
      embed_url: id ? `https://player.vimeo.com/video/${id}` : null,
      source_url: url,
    };
  }
  if (provider === "direct") {
    return { provider: "direct", file_id: null, embed_url: url, source_url: url };
  }
  // Provider desconhecido: salvamos como direct e deixamos o player tentar
  return { provider: null, file_id: null, embed_url: url, source_url: url };
}
