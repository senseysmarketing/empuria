import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { ArrowDownToLine, ArrowUpFromLine, Settings2, Loader2 } from "lucide-react";
import {
  registerStockEntry,
  registerStockExit,
  adjustStock,
  getProductStockHistory,
} from "@/lib/admin/pdv-stock.functions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product: { id: string; name: string; stock_quantity: number } | null;
};

const typeLabel: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste: "Ajuste",
  venda: "Venda PDV",
  cancelamento: "Cancelamento",
};

type PendingAction =
  | { kind: "entrada"; qty: number; reason: string }
  | { kind: "saida"; qty: number; reason: string }
  | { kind: "ajuste"; newQty: number; reason: string };

export function StockMovementsDialog({ open, onOpenChange, product }: Props) {
  const entry = useServerFn(registerStockEntry);
  const exit = useServerFn(registerStockExit);
  const adj = useServerFn(adjustStock);
  const history = useServerFn(getProductStockHistory);
  const qc = useQueryClient();

  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  const [newQty, setNewQty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const { data: rows = [], refetch } = useQuery({
    queryKey: ["stock-history", product?.id],
    queryFn: () => history({ data: { productId: product!.id } }),
    enabled: !!product && open,
  });

  if (!product) return null;

  const refresh = () => {
    refetch();
    qc.invalidateQueries({ queryKey: ["pdv-itens"] });
  };

  const request = (action: PendingAction) => {
    if (!action.reason.trim()) {
      toast.error("Informe um motivo");
      return;
    }
    if ((action.kind === "entrada" || action.kind === "saida") && (!action.qty || action.qty < 1)) {
      toast.error("Quantidade inválida");
      return;
    }
    setPending(action);
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "entrada") {
        await entry({ data: { productId: product.id, quantity: pending.qty, reason: pending.reason } });
        toast.success("Entrada registrada");
      } else if (pending.kind === "saida") {
        await exit({ data: { productId: product.id, quantity: pending.qty, reason: pending.reason } });
        toast.success("Saída registrada");
      } else {
        await adj({ data: { productId: product.id, newQuantity: pending.newQty, reason: pending.reason } });
        toast.success("Estoque ajustado");
      }
      setReason("");
      setQty(1);
      setPending(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  const current = product.stock_quantity;
  let confirmTitle = "";
  let confirmDesc: React.ReactNode = null;
  if (pending?.kind === "entrada") {
    const after = current + pending.qty;
    confirmTitle = "Confirmar entrada";
    confirmDesc = (
      <>
        Confirmar entrada de <strong>{pending.qty}</strong> unidade(s) de <strong>{product.name}</strong>?
        <br />
        Estoque passará de <strong>{current}</strong> para <strong>{after}</strong>.
      </>
    );
  } else if (pending?.kind === "saida") {
    const after = current - pending.qty;
    confirmTitle = "Confirmar saída";
    confirmDesc = (
      <>
        Confirmar saída de <strong>{pending.qty}</strong> unidade(s) de <strong>{product.name}</strong>?
        <br />
        Estoque passará de <strong>{current}</strong> para{" "}
        <strong className={after < 0 ? "text-red-500" : ""}>{after}</strong>.
        {after < 0 && <div className="mt-1 text-red-500 text-xs">Atenção: estoque ficará negativo.</div>}
      </>
    );
  } else if (pending?.kind === "ajuste") {
    const diff = pending.newQty - current;
    confirmTitle = "Confirmar ajuste";
    confirmDesc = (
      <>
        Ajustar estoque de <strong>{product.name}</strong> de <strong>{current}</strong> para{" "}
        <strong>{pending.newQty}</strong> (diferença: {diff >= 0 ? `+${diff}` : diff}).
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto bg-admin-surface border-admin-border text-admin-ink">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Estoque · {product.name}</DialogTitle>
            <DialogDescription>
              Estoque atual: <strong className="text-admin-ink">{product.stock_quantity}</strong> unidade(s)
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="entrada" className="mt-2">
            <TabsList className="grid grid-cols-4 bg-admin-bg">
              <TabsTrigger value="entrada"><ArrowDownToLine className="h-3.5 w-3.5 mr-1" /> Entrada</TabsTrigger>
              <TabsTrigger value="saida"><ArrowUpFromLine className="h-3.5 w-3.5 mr-1" /> Saída</TabsTrigger>
              <TabsTrigger value="ajuste"><Settings2 className="h-3.5 w-3.5 mr-1" /> Ajustar</TabsTrigger>
              <TabsTrigger value="hist">Histórico</TabsTrigger>
            </TabsList>

            <TabsContent value="entrada" className="space-y-3 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantidade</Label>
                  <Input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value || "1", 10))} className="bg-admin-bg border-admin-border" />
                </div>
                <div className="space-y-1.5">
                  <Label>Motivo</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Compra do fornecedor" className="bg-admin-bg border-admin-border" />
                </div>
              </div>
              <Button disabled={busy} onClick={() => request({ kind: "entrada", qty, reason })} className="bg-admin-accent text-white">
                Registrar entrada
              </Button>
            </TabsContent>

            <TabsContent value="saida" className="space-y-3 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Quantidade</Label>
                  <Input type="number" min={1} value={qty} onChange={(e) => setQty(parseInt(e.target.value || "1", 10))} className="bg-admin-bg border-admin-border" />
                </div>
                <div className="space-y-1.5">
                  <Label>Motivo</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Perda / consumo interno" className="bg-admin-bg border-admin-border" />
                </div>
              </div>
              <Button disabled={busy} onClick={() => request({ kind: "saida", qty, reason })} className="bg-admin-accent text-white">
                Registrar saída
              </Button>
            </TabsContent>

            <TabsContent value="ajuste" className="space-y-3 pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Novo estoque</Label>
                  <Input type="number" min={0} value={newQty} onChange={(e) => setNewQty(parseInt(e.target.value || "0", 10))} className="bg-admin-bg border-admin-border" />
                </div>
                <div className="space-y-1.5">
                  <Label>Motivo</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contagem física" className="bg-admin-bg border-admin-border" />
                </div>
              </div>
              <Button disabled={busy} onClick={() => request({ kind: "ajuste", newQty, reason })} className="bg-admin-accent text-white">
                Ajustar estoque
              </Button>
            </TabsContent>

            <TabsContent value="hist" className="pt-4">
              <div className="overflow-x-auto rounded-lg border border-admin-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-admin-bg text-[10px] uppercase tracking-wider text-admin-ink-muted">
                    <tr>
                      <th className="text-left p-2">Data</th>
                      <th className="text-left p-2">Tipo</th>
                      <th className="text-right p-2">Qtd</th>
                      <th className="text-right p-2">Antes</th>
                      <th className="text-right p-2">Depois</th>
                      <th className="text-left p-2">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-t border-admin-border">
                        <td className="p-2 text-admin-ink-muted">{new Date(r.created_at).toLocaleString("pt-BR")}</td>
                        <td className="p-2">{typeLabel[r.type] ?? r.type}</td>
                        <td className="p-2 text-right tabular-nums">{r.quantity}</td>
                        <td className="p-2 text-right tabular-nums">{r.previous_stock}</td>
                        <td className="p-2 text-right tabular-nums">{r.new_stock}</td>
                        <td className="p-2 text-admin-ink-muted">{r.reason ?? "—"}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr><td colSpan={6} className="p-6 text-center text-admin-ink-muted">Sem movimentações</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pending} onOpenChange={(v) => { if (!v && !busy) setPending(null); }}>
        <AlertDialogContent className="bg-admin-surface border-admin-border text-admin-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-admin-ink-muted">
              {confirmDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => { e.preventDefault(); confirm(); }}
              className="bg-admin-accent text-white"
            >
              {busy ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Processando…</>
              ) : (
                "Confirmar"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
