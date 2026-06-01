import { useRef, useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { lookupPassport } from "@/lib/admin/pdv.functions";
import { parsePassportQrPayload } from "@/lib/passport-qr";
import { PassportContextModal, type PassportContext } from "./PassportContextModal";
import { Camera, Search, ScanLine } from "lucide-react";
import { toast } from "sonner";

export function PassportScannerDialog() {
  const [open, setOpen] = useState(false);
  const [manualId, setManualId] = useState("");
  const [context, setContext] = useState<PassportContext | null>(null);
  const [scanning, setScanning] = useState(false);
  const scanLockRef = useRef(false);
  const lookup = useServerFn(lookupPassport);

  const handle = async (raw: string) => {
    if (scanLockRef.current) return;
    scanLockRef.current = true;
    const userId = parsePassportQrPayload(raw);
    if (!userId) {
      toast.error("Codigo de passaporte invalido");
      window.setTimeout(() => { scanLockRef.current = false; }, 1000);
      return;
    }

    try {
      setScanning(true);
      const ctx = await lookup({ data: { userId } });
      setContext(ctx as PassportContext);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar passaporte");
    } finally {
      scanLockRef.current = false;
      setScanning(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2.5 px-4 h-11 rounded-lg bg-brown-deep/60 hover:bg-brown-deep border border-orange-brand/30 hover:border-orange-brand/60 text-offwhite hover:text-orange-brand transition-colors font-display text-xs uppercase tracking-wider"
        title="Escanear Passaporte"
      >
        <Camera className="h-[18px] w-[18px]" />
        <span className="hidden md:inline">Escanear Passaporte</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-admin-surface border-admin-border text-admin-ink max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display flex items-center gap-2">
              <ScanLine className="h-5 w-5 text-admin-accent" /> Escanear Passaporte
            </DialogTitle>
          </DialogHeader>
          <div className="rounded-xl overflow-hidden border border-admin-border bg-black aspect-square">
            {open && (
              <Scanner
                onScan={(results) => {
                  if (results.length > 0) handle(results[0].rawValue);
                }}
                onError={() => toast.error("Nao foi possivel acessar a camera")}
                constraints={{ facingMode: "environment" }}
                styles={{ container: { width: "100%", height: "100%" }, video: { objectFit: "cover" } }}
              />
            )}
          </div>
          <div className="space-y-2">
            <p className="text-xs text-admin-ink-muted font-display uppercase tracking-wider">Ou digite o ID</p>
            <div className="flex gap-2">
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="empuria:passport:v1:uuid ou uuid"
                className="bg-admin-surface-2 border-admin-border"
              />
              <Button onClick={() => handle(manualId)} variant="secondary" disabled={scanning}>
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {context && (
        <PassportContextModal context={context} open={!!context} onClose={() => setContext(null)} />
      )}
    </>
  );
}
