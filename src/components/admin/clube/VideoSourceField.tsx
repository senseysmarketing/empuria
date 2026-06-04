import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildVideoFromUrl, detectVideoProvider, type VideoProvider } from "@/lib/clube/video-provider";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

const providerLabel: Record<VideoProvider, string> = {
  google_drive: "Google Drive",
  youtube: "YouTube",
  vimeo: "Vimeo",
  direct: "Arquivo direto",
};

export function VideoSourceField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);

  const detected = useMemo(() => {
    const trimmed = (value ?? "").trim();
    if (!trimmed) return { provider: null as VideoProvider | null, embedUrl: null as string | null, errorMessage: null as string | null };
    try {
      const built = buildVideoFromUrl(trimmed);
      return {
        provider: built.provider,
        embedUrl: built.embed_url,
        errorMessage: null,
      };
    } catch (e) {
      return {
        provider: detectVideoProvider(trimmed),
        embedUrl: null,
        errorMessage: e instanceof Error ? e.message : "Link inválido",
      };
    }
  }, [value]);

  return (
    <div className="space-y-2 rounded-lg border border-admin-border bg-admin-bg/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs uppercase tracking-wider text-admin-ink-soft">Vídeo da aula</Label>
        {detected.provider && (
          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
            {providerLabel[detected.provider]}
          </Badge>
        )}
      </div>

      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowPreview(false);
        }}
        placeholder="Cole o link do vídeo (Google Drive, YouTube, Vimeo ou arquivo .mp4)"
      />

      {error && <p className="text-xs text-admin-danger">URL inválida.</p>}
      {detected.errorMessage && (
        <p className="flex items-center gap-1 text-xs text-admin-danger">
          <AlertCircle className="h-3 w-3" /> {detected.errorMessage}
        </p>
      )}
      {detected.provider && !detected.errorMessage && (
        <p className="flex items-center gap-1 text-xs text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> Link reconhecido.
        </p>
      )}

      {detected.provider === "google_drive" && (
        <div className="flex items-start gap-2 rounded-md bg-admin-accent-soft p-2 text-[11px] text-admin-ink-soft">
          <Info className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-admin-accent" />
          <span>
            Para o vídeo do Google Drive abrir aqui, defina o compartilhamento como
            <strong> "Qualquer pessoa com o link"</strong> em modo <strong>Leitor</strong>.
          </span>
        </div>
      )}

      {detected.embedUrl && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowPreview((s) => !s)}>
            {showPreview ? "Ocultar pré-visualização" : "Validar pré-visualização"}
          </Button>
          {showPreview && (
            <div className="mt-2 aspect-video rounded-md overflow-hidden border border-admin-border bg-black">
              {detected.provider === "direct" ? (
                <video controls src={detected.embedUrl} className="w-full h-full" />
              ) : (
                <iframe
                  src={detected.embedUrl}
                  className="w-full h-full"
                  allow="autoplay; encrypted-media; fullscreen"
                  allowFullScreen
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
