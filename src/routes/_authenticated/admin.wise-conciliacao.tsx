import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2,
  Eye,
  Loader2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ignoreWiseEvent,
  listWiseEvents,
  manuallyApproveWisePayment,
  manuallyMatchWiseEvent,
} from "@/lib/wise/wise.functions";

export const Route = createFileRoute("/_authenticated/admin/wise-conciliacao")({
  component: WiseConciliacaoPage,
});

function WiseConciliacaoPage() {
  const list = useServerFn(listWiseEvents);
  const match = useServerFn(manuallyMatchWiseEvent);
  const ignore = useServerFn(ignoreWiseEvent);
  const approve = useServerFn(manuallyApproveWisePayment);

  const [tab, setTab] = useState<string>("pending");
  const [matchOpen, setMatchOpen] = useState<string | null>(null);
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveOrderId, setApproveOrderId] = useState("");
  const [approveReason, setApproveReason] = useState("");

  const q = useQuery({
    queryKey: ["wise-events", tab],
    queryFn: () => list({ data: { matchStatus: tab === "all" ? undefined : tab, limit: 100 } }),
  });

  const matchMutation = useMutation({
    mutationFn: (vars: { eventId: string; orderId: string; notes: string }) =>
      match({ data: { eventId: vars.eventId, orderId: vars.orderId, approve: true, notes: vars.notes } }),
    onSuccess: () => {
      toast.success("Evento vinculado");
      setMatchOpen(null);
      setOrderId("");
      setNotes("");
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const ignoreMutation = useMutation({
    mutationFn: (eventId: string) => ignore({ data: { eventId } }),
    onSuccess: () => {
      toast.success("Evento ignorado");
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const approveMutation = useMutation({
    mutationFn: () => approve({ data: { orderId: approveOrderId, reason: approveReason } }),
    onSuccess: () => {
      toast.success("Pedido aprovado manualmente");
      setApproveOpen(false);
      setApproveOrderId("");
      setApproveReason("");
      q.refetch();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const events = (q.data?.events ?? []) as Array<{
    id: string;
    event_id: string | null;
    event_type: string;
    match_status: string;
    signature_valid: boolean;
    payload: Record<string, unknown>;
    matched_order_id: string | null;
    processed_at: string | null;
    notes: string | null;
    created_at: string;
  }>;

  return (
    <div className="space-y-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Conciliacao Wise</h1>
          <p className="text-sm text-admin-ink-muted">
            Eventos do webhook Wise e aprovacao manual de pedidos em EUR.
          </p>
        </div>
        <Button variant="outline" onClick={() => setApproveOpen(true)}>
          Aprovar pedido manualmente
        </Button>
      </header>

      <div className="flex gap-1 rounded-md bg-admin-surface-muted/40 p-1 text-sm">
        {[
          ["pending", "Pendentes"],
          ["underpaid", "Underpaid"],
          ["overpaid", "Overpaid"],
          ["auto_matched", "Auto-conciliados"],
          ["manual_matched", "Manuais"],
          ["ignored", "Ignorados"],
          ["all", "Todos"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded px-3 py-1.5 ${
              tab === key
                ? "bg-admin-surface text-admin-ink shadow-sm"
                : "text-admin-ink-muted hover:text-admin-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 text-admin-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-admin-border p-10 text-center text-admin-ink-muted">
          Nenhum evento.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((e) => {
            const payload = e.payload as Record<string, unknown>;
            const reference =
              (payload.reference as string) ??
              ((payload.data as Record<string, unknown> | undefined)?.reference as string) ??
              null;
            const amount =
              (payload.amount as number) ??
              ((payload.data as Record<string, unknown> | undefined)?.amount as number) ??
              null;
            const currency =
              (payload.currency as string) ??
              ((payload.data as Record<string, unknown> | undefined)?.currency as string) ??
              null;
            return (
              <div
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-admin-border bg-admin-surface px-4 py-3 text-sm"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{e.event_type}</Badge>
                    <StatusBadge status={e.match_status} />
                    {!e.signature_valid && (
                      <Badge className="bg-amber-100 text-amber-800">sem assinatura</Badge>
                    )}
                  </div>
                  <div className="text-xs text-admin-ink-muted">
                    {new Date(e.created_at).toLocaleString("pt-PT")} ·{" "}
                    {reference ? <strong className="text-admin-ink">{reference}</strong> : "sem ref"}{" "}
                    {amount ? `· ${amount} ${currency ?? ""}` : null}
                  </div>
                  {e.notes && <div className="text-xs text-admin-ink-muted">Nota: {e.notes}</div>}
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      toast.success("Payload copiado");
                    }}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  {e.match_status === "pending" || e.match_status === "underpaid" || e.match_status === "overpaid" ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => {
                          setMatchOpen(e.id);
                          setOrderId(e.matched_order_id ?? "");
                          setNotes("");
                        }}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" /> Vincular
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => ignoreMutation.mutate(e.id)}
                      >
                        <XCircle className="h-4 w-4 mr-1" /> Ignorar
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!matchOpen} onOpenChange={(o) => !o && setMatchOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vincular ao pedido</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Order ID (UUID)</Label>
              <Input value={orderId} onChange={(e) => setOrderId(e.target.value)} />
            </div>
            <div>
              <Label>Notas</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMatchOpen(null)}>
                Cancelar
              </Button>
              <Button
                disabled={!orderId || matchMutation.isPending}
                onClick={() =>
                  matchOpen &&
                  matchMutation.mutate({ eventId: matchOpen, orderId: orderId.trim(), notes })
                }
              >
                {matchMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Vincular e aprovar"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar pedido manualmente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Order ID (UUID)</Label>
              <Input value={approveOrderId} onChange={(e) => setApproveOrderId(e.target.value)} />
            </div>
            <div>
              <Label>Motivo (min 10 caracteres)</Label>
              <Input value={approveReason} onChange={(e) => setApproveReason(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveOpen(false)}>
                Cancelar
              </Button>
              <Button
                disabled={
                  !approveOrderId || approveReason.length < 10 || approveMutation.isPending
                }
                onClick={() => approveMutation.mutate()}
              >
                {approveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Aprovar"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    auto_matched: "bg-emerald-100 text-emerald-800",
    manual_matched: "bg-blue-100 text-blue-800",
    pending: "bg-amber-100 text-amber-800",
    underpaid: "bg-orange-100 text-orange-800",
    overpaid: "bg-violet-100 text-violet-800",
    ignored: "bg-gray-100 text-gray-700",
  };
  return <Badge className={map[status] ?? ""}>{status}</Badge>;
}
