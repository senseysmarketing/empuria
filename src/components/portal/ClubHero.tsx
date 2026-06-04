import { CheckCircle2, Crown, MessageCircle, Play, Sparkles } from "lucide-react";

export function ClubHero({
  title,
  subtitle,
  coverUrl,
  isMember,
  hasSelected,
  onContinue,
  onBrowseModules,
  whatsappUrl,
}: {
  title: string;
  subtitle: string;
  coverUrl?: string | null;
  isMember: boolean;
  hasSelected: boolean;
  onContinue?: () => void;
  onBrowseModules?: () => void;
  whatsappUrl?: string | null;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-white/10 isolate">
      {/* Base layer: deep brown gradient */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.22 0.07 38) 0%, oklch(0.16 0.05 32) 60%, oklch(0.12 0.04 30) 100%)",
        }}
      />
      {/* Optional cover image with brown overlay */}
      {coverUrl && (
        <div
          className="absolute inset-0 -z-10 opacity-40 mix-blend-overlay"
          style={{ backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      )}
      {/* Radial golden glow */}
      <div
        className="absolute -top-32 -right-24 -z-10 h-[420px] w-[420px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.13 75) 0%, transparent 70%)" }}
      />
      {/* Subtle texture */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, white 1px, transparent 0)",
          backgroundSize: "22px 22px",
        }}
      />

      <div className="p-8 md:p-12 text-offwhite">
        <div className="flex flex-wrap items-end justify-between gap-8">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full bg-yellow-brand/15 px-3 py-1 text-[10px] uppercase tracking-[0.3em] font-display text-yellow-brand mb-4 border border-yellow-brand/20">
              <Crown className="h-3.5 w-3.5" /> Clube premium
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              {title}
            </h1>
            <p className="mt-4 text-base md:text-lg text-offwhite/75 font-body max-w-xl">
              {subtitle}
            </p>

            {isMember && (
              <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-3 py-1 text-[11px] uppercase tracking-[0.2em] font-display text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" /> Membro ativo
              </div>
            )}

            {isMember && (
              <div className="mt-7 flex flex-wrap gap-3">
                {onContinue && (
                  <button
                    onClick={onContinue}
                    className="inline-flex items-center gap-2 rounded-xl bg-orange-brand px-5 py-3 font-display text-xs uppercase tracking-wider text-offwhite hover:bg-orange-brand/90 transition shadow-lg"
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {hasSelected ? "Continuar assistindo" : "Comece por aqui"}
                  </button>
                )}
                {onBrowseModules && (
                  <button
                    onClick={onBrowseModules}
                    className="inline-flex items-center gap-2 rounded-xl border border-offwhite/20 bg-white/5 backdrop-blur px-5 py-3 font-display text-xs uppercase tracking-wider text-offwhite/90 hover:bg-white/10 transition"
                  >
                    <Sparkles className="h-4 w-4" /> Ver todos os módulos
                  </button>
                )}
              </div>
            )}
          </div>

          {isMember && whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 font-display text-xs uppercase tracking-wider text-white hover:bg-emerald-700 shadow-lg"
            >
              <MessageCircle className="h-4 w-4" /> Grupo no WhatsApp
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
