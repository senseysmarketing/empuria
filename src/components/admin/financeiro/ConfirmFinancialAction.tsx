import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ConfirmFinancialAction({
  open,
  title,
  description,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        {error && (
          <p
            role="alert"
            className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Processando..." : "Confirmar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
