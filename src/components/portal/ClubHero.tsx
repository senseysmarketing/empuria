import { CheckCircle2, Crown, MessageCircle, Play, Search, Sparkles, X } from "lucide-react";

// SVG de textura igual ao do PassportCard (círculos concêntricos + ondas em dourado)
const PASSPORT_TEXTURE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><g fill='none' stroke='%23e5a657' stroke-width='1' opacity='0.6'><circle cx='100' cy='200' r='60'/><circle cx='100' cy='200' r='110'/><circle cx='320' cy='100' r='50'/><path d='M0 80 Q100 40 200 80 T400 80'/><path d='M0 320 Q100 280 200 320 T400 320'/></g></svg>\")";

export function ClubHero({
  title,
  subtitle,
  coverUrl,
  isMember,
  hasSelected,
  onContinue,
  onBrowseModules,
  whatsappUrl,
  searchValue,
  onSearchChange,
}: {
  title: string;
  subtitle: string;
  coverUrl?: string | null;
  isMember: boolean;
  hasSelected: boolean;
  onContinue?: () => void;
  onBrowseModules?: () => void;
  whatsappUrl?: string | null;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
}) {
  return (
    <header className="relative overflow-hidden rounded-3xl border border-white/10 isolate">
      {/* Base: gradiente marrom Empuria */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, oklch(0.30 0.09 38) 0%, oklch(0.22 0.07 38) 55%, oklch(0.16 0.05 32) 100%)",
        }}
      />
      {/* Cover opcional como camada com overlay */}
      {coverUrl && (
        <div
          className="absolute inset-0 -z-10 opacity-40 mix-blend-overlay"
          style={{ backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}
        />
      )}
      {/* Glow dourado */}
      <div
        className="absolute -top-32 -right-24 -z-10 h-[420px] w-[420px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.13 75) 0%, transparent 70%)" }}
      />
      {/* Textura passaporte Empuria */}
      <div
        className="absolute inset-0 -z-10 opacity-25"
        style={{ backgroundImage: PASSPORT_TEXTURE }}
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

            {isMember && onSearchChange && (
              <div className="mt-6 relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-offwhite/50" />
                <input
                  value={searchValue ?? ""}
                  onChange={(e) => onSearchChange(e.target.value)}
                  placeholder="Buscar aula por título…"
                  className="w-full rounded-xl border border-offwhite/15 bg-black/30 backdrop-blur pl-9 pr-9 py-2.5 text-sm font-body text-offwhite placeholder:text-offwhite/40 focus:outline-none focus:border-yellow-brand/40"
                />
                {searchValue && (
                  <button
                    onClick={() => onSearchChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-offwhite/60 hover:text-offwhite"
                    aria-label="Limpar"
                  >
                    <X className="h-3.5 w-3.5" />
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
