import { useEffect, useState } from "react";
import QRCode from "qrcode";
import logoIcone from "@/assets/logo-empuria-icone.png";

export function PassportCard({
  userId,
  fullName,
  memberSince,
  isClubMember,
}: {
  userId: string;
  fullName: string;
  memberSince?: string | null;
  isClubMember: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(`empuria:${userId}`, { width: 220, margin: 1, color: { dark: "#1a0c05", light: "#f5e9d4" } }).then(
      setQr,
    );
  }, [userId]);

  const passNum = userId.replace(/-/g, "").slice(0, 12).toUpperCase();
  const since = memberSince
    ? new Date(memberSince).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    : "—";

  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brown-deep via-brown to-red-brand text-offwhite shadow-[var(--shadow-admin-hover)] border border-brown/60">
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><g fill='none' stroke='%23e5a657' stroke-width='1' opacity='0.6'><circle cx='100' cy='200' r='60'/><circle cx='100' cy='200' r='110'/><circle cx='320' cy='100' r='50'/><path d='M0 80 Q100 40 200 80 T400 80'/><path d='M0 320 Q100 280 200 320 T400 320'/></g></svg>\")",
        }}
      />
      <div className="relative p-6 md:p-7 flex flex-col md:flex-row gap-6">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-5">
            <div className="h-10 w-10 rounded-lg bg-offwhite/10 backdrop-blur flex items-center justify-center">
              <img src={logoIcone} alt="Empuria" className="h-7 w-7 object-contain" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.25em] font-display text-yellow-brand/90">
                Passaporte Empuria
              </div>
              <div className="text-xs font-display uppercase tracking-wider text-offwhite/70">
                Boarding Pass · Madrid
              </div>
            </div>
          </div>

          <div className="text-[10px] uppercase tracking-widest font-display text-offwhite/60 mb-1">Passageiro</div>
          <div className="font-display text-2xl md:text-3xl font-bold truncate">{fullName || "Imigrante"}</div>

          <div className="mt-5 grid grid-cols-3 gap-4 text-[10px] uppercase tracking-widest font-display">
            <div>
              <div className="text-offwhite/50">Nº Passaporte</div>
              <div className="text-yellow-brand text-sm tabular-nums mt-1">{passNum}</div>
            </div>
            <div>
              <div className="text-offwhite/50">Embarcou em</div>
              <div className="text-offwhite text-sm mt-1">{since}</div>
            </div>
            <div>
              <div className="text-offwhite/50">Classe</div>
              <div className="text-yellow-brand text-sm mt-1">{isClubMember ? "Clube" : "Standard"}</div>
            </div>
          </div>

          <div className="mt-5 border-t border-dashed border-offwhite/20 pt-3 text-[10px] uppercase tracking-widest font-display text-offwhite/50">
            Apresente este código na recepção da Gran Vía
          </div>
        </div>

        <div className="flex-shrink-0 flex flex-col items-center justify-center gap-2">
          {qr ? (
            <img src={qr} alt="QR Passaporte" className="h-32 w-32 md:h-36 md:w-36 rounded-lg bg-offwhite/95 p-1.5" />
          ) : (
            <div className="h-32 w-32 md:h-36 md:w-36 rounded-lg bg-offwhite/10 animate-pulse" />
          )}
          <div className="text-[9px] uppercase tracking-widest font-display text-offwhite/50">Check-in</div>
        </div>
      </div>
    </div>
  );
}
