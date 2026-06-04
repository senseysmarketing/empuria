import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  listOrders,
  updateOrder,
  markOrderPaidManual,
  cancelOrder,
  refundOrder,
  generatePaymentLink,
} from "@/lib/admin/esteira.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  CheckCircle2,
  Plus,
  QrCode,
  MoreHorizontal,
  Link2,
  Copy,
  Ban,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";
import { NewOrderWizard } from "@/components/admin/esteira/NewOrderWizard";

export const Route = createFileRoute("/_authenticated/admin/esteira")({
  component: EsteiraPage,
});

const STATUS_COLOR: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-900",
  aprovado: "bg-emerald-100 text-emerald-900",
  recusado: "bg-red-100 text-red-900",
  estornado: "bg-slate-200 text-slate-700",
};

const DELIVERY_COLOR: Record<string, string> = {
  aguardando_pagamento: "bg-amber-50 text-amber-800",
  aguardando_documentos: "bg-blue-50 text-blue-800",
  processando: "bg-indigo-50 text-indigo-800",
  agendado: "bg-purple-50 text-purple-800",
  concluido: "bg-emerald-50 text-emerald-800",
};

const FILTERS = [
  { key: "todos", label: "Todos" },
  { key: "pendente", label: "Pendentes" },
  { key: "aguardando_pagamento", label: "Aguardando pagamento" },
  { key: "aprovado", label: "Pagos" },
  { key: "processando", label: "Em execução" },
  { key: "concluido", label: "Concluídos" },
  { key: "recusado", label: "Cancelados" },
  { key: "estornado", label: "Estornados" },
];

type Order = {
  id: string;
  user_id?: string | null;
  customer_name: string;
  customer_email: string | null;
  service_title: string;
  payment_status: "pendente" | "aprovado" | "recusado" | "estornado";
  delivery_status?: "aguardando_pagamento" | "aguardando_documentos" | "processando" | "agendado" | "concluido";
  voucher_code: string | null;
  created_at: string;
  executed_at: string | null;
  amount_cents?: number;
  currency?: string;
  payment_amount_cents?: number | null;
  payment_currency?: string | null;
  payment_method?: string | null;
  payment_url?: string | null;
  payment_provider_reference?: string | null;
  notes?: string | null;
  canViewFinancials: boolean;
};

function EsteiraPage() {
  const { isAdmin } = useCurrentUser();
  const fetchOrders = useServerFn(listOrders);
  const update = useServerFn(updateOrder);
  const markManual = useServerFn(markOrderPaidManual);
  const cancel = useServerFn(cancelOrder);
  const refund = useServerFn(refundOrder);
  const genLink = useServerFn(generatePaymentLink);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("todos");
  const [voucherUrl, setVoucherUrl] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [actionPrompt, setActionPrompt] = useState<{
    kind: "manual" | "cancel" | "refund";
    order: Order;
  } | null>(null);
  const [reasonInput, setReasonInput] = useState("");
  const [linkModal, setLinkModal] = useState<{
    order: Order;
    loading: boolean;
    reference: string | null;
    paymentUrl: string | null;
    error: string | null;
  } | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders() as unknown as Promise<Order[]>,
  });

  const filtered = useMemo(() => {
    if (filter === "todos") return orders;
    // status filters
    if (["pendente", "aprovado", "recusado", "estornado"].includes(filter))
      return orders.filter((o) => o.payment_status === filter);
    return orders.filter((o) => o.delivery_status === filter);
  }, [orders, filter]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["orders"] });
  const canViewFinancials = isAdmin;

  // Summary tiles
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = (s: string) => new Date(s).getTime() >= today.getTime();
  const summary = useMemo(() => {
    const todayCount = orders.filter((o) => isToday(o.created_at)).length;
    const waiting = orders.filter((o) => o.payment_status === "pendente").length;
    const paidToday = orders.filter(
      (o) => o.payment_status === "aprovado" && isToday(o.created_at),
    ).length;
    const inExec = orders.filter((o) => o.delivery_status === "processando").length;
    const late = orders.filter(
      (o) =>
        o.payment_status === "pendente" &&
        new Date(o.created_at).getTime() < Date.now() - 1000 * 60 * 60 * 48,
    ).length;
    let brl = 0;
    let eur = 0;
    for (const o of orders) {
      if (o.payment_status !== "aprovado") continue;
      const cents = o.amount_cents ?? 0;
      if ((o.currency ?? "EUR") === "BRL") brl += cents;
      else eur += cents;
    }
    return { todayCount, waiting, paidToday, inExec, late, brl, eur };
  }, [orders]);

  const showVoucher = async (code: string) => {
    const dataUrl = await QRCode.toDataURL(code, { width: 320, margin: 2 });
    setVoucherUrl(dataUrl);
    setVoucherCode(code);
  };

  const setStatus = async (
    id: string,
    status: "pendente" | "aprovado" | "recusado" | "estornado",
  ) => {
    try {
      await update({ data: { id, payment_status: status } });
      toast.success("Status atualizado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const markExecuted = async (id: string) => {
    await update({ data: { id, executed: true } });
    toast.success("Marcado como executado");
    refresh();
  };

  const doGenLink = async (id: string) => {
    try {
      const r = await genLink({ data: { id } });
      toast.info(r.message ?? "Link gerado");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const runPrompt = async () => {
    if (!actionPrompt || reasonInput.trim().length < 3) {
      toast.error("Motivo obrigatório (mín. 3 caracteres)");
      return;
    }
    try {
      const { kind, order } = actionPrompt;
      if (kind === "manual") await markManual({ data: { id: order.id, reason: reasonInput } });
      if (kind === "cancel") await cancel({ data: { id: order.id, reason: reasonInput } });
      if (kind === "refund") await refund({ data: { id: order.id, reason: reasonInput } });
      toast.success("Ação registrada");
      setActionPrompt(null);
      setReasonInput("");
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Central de Pedidos</h1>
          <p className="text-admin-ink-muted text-sm mt-1">
            Pedidos do site, vendas no WhatsApp, consultorias e compromissos comerciais.
          </p>
        </div>
        <Button
          className="bg-admin-accent hover:bg-admin-accent/90 gap-2"
          onClick={() => setWizardOpen(true)}
        >
          <Plus className="h-4 w-4" /> Criar pedido
        </Button>
      </header>

      {canViewFinancials && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Tile label="Pedidos hoje" value={summary.todayCount} />
          <Tile label="Aguardando pagamento" value={summary.waiting} />
          <Tile label="Pagos hoje" value={summary.paidToday} />
          <Tile label="Em execução" value={summary.inExec} />
          <Tile label="Atrasados" value={summary.late} />
          <Tile label="Receita BRL" value={`R$ ${(summary.brl / 100).toFixed(2)}`} />
          <Tile label="Receita EUR" value={`€ ${(summary.eur / 100).toFixed(2)}`} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`text-xs uppercase tracking-wider font-display px-3 py-1.5 rounded-full border transition ${
              filter === f.key
                ? "bg-admin-accent text-white border-admin-accent"
                : "bg-admin-surface text-admin-ink-muted border-admin-border hover:border-admin-accent"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <BentoCard padded={false}>
        {isLoading ? (
          <p className="p-6 text-admin-ink-muted">Carregando...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-admin-ink-muted">Nenhum pedido nesta categoria.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-admin-surface-2 text-xs uppercase tracking-wider text-admin-ink-muted">
                <tr>
                  <th className="text-left px-4 py-3">Cliente</th>
                  <th className="text-left px-4 py-3">Serviço</th>
                  {canViewFinancials && <th className="text-right px-4 py-3">Valor</th>}
                  <th className="text-left px-4 py-3">Pagamento</th>
                  <th className="text-left px-4 py-3">Execução</th>
                  <th className="text-left px-4 py-3">Voucher</th>
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-right px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr
                    key={o.id}
                    className="border-t border-admin-border hover:bg-admin-surface-2/60 cursor-pointer"
                    onClick={() => setSelected(o)}
                  >
                    <td className="px-4 py-3">
                      <div className="text-admin-ink flex items-center gap-2">
                        {o.customer_name}
                        {!o.user_id && (
                          <span className="text-[9px] uppercase bg-amber-100 text-amber-800 px-1.5 rounded">
                            sem conta
                          </span>
                        )}
                      </div>
                      {o.customer_email && (
                        <div className="text-xs text-admin-ink-muted">{o.customer_email}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-admin-ink-soft">{o.service_title}</td>
                    {canViewFinancials && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        {(() => {
                          const cur = o.currency ?? "EUR";
                          const payCur = o.payment_currency ?? cur;
                          const payCents = o.payment_amount_cents ?? o.amount_cents ?? 0;
                          if (cur === "BRL") {
                            return <div>R$ {((o.amount_cents ?? 0) / 100).toFixed(2)}</div>;
                          }
                          if (payCur === "BRL") {
                            return (
                              <div>
                                <div>R$ {(payCents / 100).toFixed(2)}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  ({cur === "EUR" ? "€" : cur} {((o.amount_cents ?? 0) / 100).toFixed(2)})
                                </div>
                              </div>
                            );
                          }
                          return (
                            <div>
                              <div className="text-admin-ink-muted">R$ —</div>
                              <div className="text-[10px] text-muted-foreground">
                                {cur === "EUR" ? "€" : cur} {((o.amount_cents ?? 0) / 100).toFixed(2)}
                              </div>
                            </div>
                          );
                        })()}
                      </td>
                    )}
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <span
                        className={`inline-block px-2 py-1 rounded text-xs uppercase tracking-wider ${
                          STATUS_COLOR[o.payment_status]
                        }`}
                      >
                        {o.payment_status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.delivery_status && (
                        <span
                          className={`inline-block px-2 py-1 rounded text-[10px] uppercase tracking-wider ${
                            DELIVERY_COLOR[o.delivery_status] ?? "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {o.delivery_status.replace(/_/g, " ")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {o.voucher_code ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            showVoucher(o.voucher_code!);
                          }}
                          className="text-xs font-mono text-admin-accent hover:underline inline-flex items-center gap-1"
                        >
                          <QrCode className="h-3 w-3" /> {o.voucher_code}
                        </button>
                      ) : (
                        <span className="text-xs text-admin-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-ink-muted">
                      {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant="ghost">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => doGenLink(o.id)}>
                            <Link2 className="h-4 w-4 mr-2" /> Gerar link de pagamento
                          </DropdownMenuItem>
                          {o.payment_provider_reference && (
                            <DropdownMenuItem
                              onClick={() => {
                                navigator.clipboard.writeText(o.payment_provider_reference ?? "");
                                toast.success("Referência copiada");
                              }}
                            >
                              <Copy className="h-4 w-4 mr-2" /> Copiar referência
                            </DropdownMenuItem>
                          )}
                          {isAdmin && o.payment_status !== "aprovado" && (
                            <DropdownMenuItem
                              onClick={() => {
                                setActionPrompt({ kind: "manual", order: o });
                                setReasonInput("");
                              }}
                            >
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar pago manualmente
                            </DropdownMenuItem>
                          )}
                          {!o.executed_at && o.payment_status === "aprovado" && (
                            <DropdownMenuItem onClick={() => markExecuted(o.id)}>
                              <CheckCircle2 className="h-4 w-4 mr-2" /> Marcar executado
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          {isAdmin && (
                            <>
                              <DropdownMenuItem
                                onClick={() => {
                                  setActionPrompt({ kind: "cancel", order: o });
                                  setReasonInput("");
                                }}
                              >
                                <Ban className="h-4 w-4 mr-2" /> Cancelar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setActionPrompt({ kind: "refund", order: o });
                                  setReasonInput("");
                                }}
                              >
                                <RotateCcw className="h-4 w-4 mr-2" /> Estornar
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      {isAdmin && (
                        <select
                          value={o.payment_status}
                          onChange={(e) => setStatus(o.id, e.target.value as never)}
                          className="hidden"
                          aria-hidden
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      <NewOrderWizard open={wizardOpen} onOpenChange={setWizardOpen} onCreated={refresh} />

      <Dialog open={!!voucherUrl} onOpenChange={(o) => !o && setVoucherUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher {voucherCode}</DialogTitle>
          </DialogHeader>
          {voucherUrl && (
            <div className="flex flex-col items-center gap-3">
              <img src={voucherUrl} alt="QR Code" className="rounded-lg" />
              <a
                href={voucherUrl}
                download={`${voucherCode}.png`}
                className="text-sm text-admin-accent hover:underline"
              >
                Baixar PNG
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Pedido · {selected?.service_title}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <Row label="Cliente" value={selected.customer_name} />
              <Row label="E-mail" value={selected.customer_email ?? "—"} />
              <Row label="Conta vinculada" value={selected.user_id ? "sim" : "não — pedido não aparece no portal"} />
              {canViewFinancials && (
                <>
                  <Row
                    label="Valor comercial"
                    value={`${selected.currency ?? "EUR"} ${((selected.amount_cents ?? 0) / 100).toFixed(2)}`}
                  />
                  <Row
                    label="Valor cobrança"
                    value={
                      selected.payment_amount_cents != null
                        ? `${selected.payment_currency ?? "—"} ${(selected.payment_amount_cents / 100).toFixed(2)}`
                        : "—"
                    }
                  />
                  <Row label="Método" value={selected.payment_method ?? "—"} />
                </>
              )}
              <Row label="Pagamento" value={selected.payment_status} />
              <Row label="Execução" value={selected.delivery_status ?? "—"} />
              <Row label="Voucher" value={selected.voucher_code ?? "—"} />
              <Row label="Referência MP" value={selected.payment_provider_reference ?? "—"} />
              {selected.notes && <Row label="Notas" value={selected.notes} />}
              <p className="text-xs text-muted-foreground border-t pt-3">
                Aba de Agenda / Documentos / Histórico chega quando a migração de campos for aplicada.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionPrompt} onOpenChange={(o) => !o && setActionPrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {actionPrompt?.kind === "manual"
                ? "Marcar como pago manualmente"
                : actionPrompt?.kind === "cancel"
                  ? "Cancelar pedido"
                  : "Estornar pedido"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Informe o motivo (ficará registrado em audit_logs).
            </p>
            <textarea
              value={reasonInput}
              onChange={(e) => setReasonInput(e.target.value)}
              rows={3}
              className="w-full border rounded p-2 text-sm"
            />
            <Button onClick={runPrompt} className="w-full bg-admin-accent hover:bg-admin-accent/90">
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <BentoCard padded>
      <div className="text-[10px] uppercase tracking-wider text-admin-ink-muted">{label}</div>
      <div className="font-display text-2xl text-admin-ink mt-1 tabular-nums">{value}</div>
    </BentoCard>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b last:border-0 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-admin-ink text-right">{value}</span>
    </div>
  );
}
