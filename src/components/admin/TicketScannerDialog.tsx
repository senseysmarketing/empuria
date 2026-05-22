import { useMemo, useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import { validateEventTicket, checkInTicket } from "@/lib/admin/events.functions";
import { parsePassportQrPayload } from "@/lib/passport-qr";
import { ScanLine, Check, X, Camera } from "lucide-react";
import { toast } from "sonner";

type ValidationResult = Awaited<ReturnType<typeof validateEventTicket>>;

export function TicketScannerDialog({ events }: { events: Array<{ id: string; title: string }> }) {
  const [open, setOpen] = useState(false);
  const [eventId, setEventId] = useState<string>(events[0]?.id ?? "");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanLockRef = useRef(false);
  const validate = useServerFn(validateEventTicket);
  const checkIn = useServerFn(checkInTicket);

  const eventName = useMemo(() => events.find((e) => e.id === eventId)?.title, [eventId, events]);

  const handle = async (raw: string) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    const userId = parsePassportQrPayload(raw);
    if (!userId) {
      toast.error("Codigo de passaporte invalido");
      window.setTimeout(() => { scanLockRef.current = false; }, 1000);
      return;
    }
    if (!eventId) {
      toast.error("Selecione um evento");
      window.setTimeout(() => { scanLockRef.current = false; }, 1000);
      return;
    }

    try {
      setScanning(true);
      const res = await validate({ data: { eventId, userId } });
      setResult(res);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      scanLockRef.current = false;
      setScanning(false);
    }
  };

  const doCheckIn = async (ticketId: string) => {
    try {
      await checkIn({ data: { ticketId } });
      toast.success("Check-in realizado");
      if (result?.ok && eventId) {
        const userId = result.profile.id;
        const fresh = await validate({ data: { eventId, userId } });
        setResult(fresh);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline" className="border-admin-border">
        <ScanLine className="h-4 w-4 mr-1" /> Validar ingresso
      </Button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
        <DialogContent className="bg-admin-surface text-admin-ink border-admin-border max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-admin-accent" /> Validar ingresso
            </DialogTitle>
          </DialogHeader>

          {!result && (
            <>
              <div>
                <label className="text-xs uppercase tracking-wider font-display text-admin-ink-muted">Evento</label>
                <select value={eventId} onChange={(e) => setEventId(e.target.value)} className="w-full bg-admin-surface-2 border border-admin-border rounded-md px-3 py-2 text-sm mt-1">
                  {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </select>
              </div>
              <div className="rounded-xl overflow-hidden border border-admin-border bg-black aspect-square">
                {open && (
                  <Scanner
                    onScan={(results) => { if (results.length > 0) handle(results[0].rawValue); }}
                    onError={() => toast.error("Nao foi possivel acessar a camera")}
                    constraints={{ facingMode: "environment" }}
                    styles={{ container: { width: "100%", height: "100%" }, video: { objectFit: "cover" } }}
                  />
                )}
              </div>
              <p className="text-xs text-admin-ink-muted text-center">
                <Camera className="inline h-3 w-3 mr-1" /> Aponte para o QR do Passaporte
              </p>
            </>
          )}

          {result && !result.ok && (
            <div className="bg-red-brand/90 text-white rounded-2xl p-8 text-center">
              <X className="h-16 w-16 mx-auto" />
              <h3 className="font-display text-2xl mt-3">Acesso negado</h3>
              <p className="mt-1 opacity-90">{result.reason}</p>
              <p className="text-xs opacity-70 mt-2">Evento: {eventName}</p>
              <Button onClick={() => setResult(null)} className="mt-4 bg-white text-red-brand hover:bg-white/90">Proximo</Button>
            </div>
          )}

          {result?.ok && (
            <div className="bg-green-600 text-white rounded-2xl p-6 text-center space-y-3">
              {result.profile.avatar_url && (
                <img src={result.profile.avatar_url} alt="" className="w-20 h-20 rounded-full mx-auto border-4 border-white object-cover" />
              )}
              <div>
                <Check className="h-8 w-8 mx-auto" />
                <h3 className="font-display text-2xl mt-1">{result.profile.full_name}</h3>
                <p className="text-xs opacity-80">{eventName}</p>
              </div>
              <div className="bg-white/15 rounded-xl p-3 space-y-2 text-left">
                {result.tickets.map((t) => (
                  <div key={t.id} className={`flex items-center justify-between gap-2 ${t.status === "usado" ? "opacity-50" : ""}`}>
                    <div className="min-w-0">
                      <div className="font-display text-sm">{t.tier?.name ?? "-"}</div>
                      {t.status === "usado" && t.checked_in_at && (
                        <div className="text-[10px] opacity-80">
                          Check-in: {new Date(t.checked_in_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      )}
                      {Array.isArray(t.tier?.benefits) && (t.tier!.benefits as string[]).length > 0 && (
                        <div className="text-[10px] opacity-80 truncate">{(t.tier!.benefits as string[]).join(" / ")}</div>
                      )}
                    </div>
                    {t.status === "valido" ? (
                      <Button size="sm" onClick={() => doCheckIn(t.id)} className="bg-white text-green-700 hover:bg-white/90 shrink-0">
                        <Check className="h-3 w-3 mr-1" /> Check-in
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-widest bg-white/20 px-2 py-1 rounded">Usado</span>
                    )}
                  </div>
                ))}
              </div>
              <Button onClick={() => setResult(null)} className="bg-white text-green-700 hover:bg-white/90 w-full">Proximo</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
