import { useState } from "react";
import { Scanner } from "@yudiel/react-qr-scanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import { lookupPassport } from "@/lib/admin/pdv.functions";
import { PassportContextModal, type PassportContext } from "./PassportContextModal";
import { Camera, Search, ScanLine } from "lucide-react";
import { toast } from "sonner";

export function PassportScannerDialog() {
  const [open, setOpen] = useState(false);
  const [manualId, setManualId] = useState("");
  const [context, setContext] = useState<PassportContext | null>(null);
  const lookup = useServerFn(lookupPassport);

  const handle = async (raw: string) => {
    let userId = raw.trim();
    if (userId.startsWith("empuria:")) userId = userId.slice("empuria:".length);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(userId)) { toast.error("Código inválido"); return; }
    try {
      const ctx = await lookup({ data: { userId } });
      setContext(ctx as PassportContext);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao buscar passaporte");
    }
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        className="bg-admin-accent hover:bg-admin-accent/90"
      >
        <Camera className="h-4 w-4" /> Escanear Passaporte
      </Button>

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
                onError={() => {}}
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
                placeholder="empuria:uuid ou uuid"
                className="bg-admin-surface-2 border-admin-border"
              />
              <Button onClick={() => handle(manualId)} variant="secondary">
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
