import { useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { listOrders, updateOrder, createOrder } from "@/lib/admin/esteira.functions";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Plus, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useCurrentUser } from "@/hooks/use-current-user";

export const Route = createFileRoute("/_authenticated/admin/esteira")({
  component: EsteiraPage,
});

const STATUS_COLOR: Record<string, string> = {
  pendente: "bg-amber-100 text-amber-900",
  aprovado: "bg-emerald-100 text-emerald-900",
  recusado: "bg-red-100 text-red-900",
  estornado: "bg-slate-200 text-slate-700",
};

function EsteiraPage() {
  const { isAdmin } = useCurrentUser();
  const fetchOrders = useServerFn(listOrders);
  const update = useServerFn(updateOrder);
  const create = useServerFn(createOrder);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("todos");
  const [voucherUrl, setVoucherUrl] = useState<string | null>(null);
  const [voucherCode, setVoucherCode] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => fetchOrders(),
  });

  const filtered = useMemo(
    () => (filter === "todos" ? orders : orders.filter((o) => o.payment_status === filter)),
    [orders, filter],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: ["orders"] });
  const canViewFinancials = isAdmin;

  const showVoucher = async (code: string) => {
    const dataUrl = await QRCode.toDataURL(code, { width: 320, margin: 2 });
    setVoucherUrl(dataUrl);
    setVoucherCode(code);
  };

  const setStatus = async (id: string, status: "pendente" | "aprovado" | "recusado" | "estornado") => {
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

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold tracking-tight">Esteira 1</h1>
          <p className="text-admin-ink-muted text-sm mt-1">Serviços de compra rápida: tours, vale transporte, abertura de conta.</p>
        </div>
        <div className="flex gap-2 items-center">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40 bg-admin-surface"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os status</SelectItem>
              <SelectItem value="pendente">Pendente</SelectItem>
              <SelectItem value="aprovado">Aprovado</SelectItem>
              <SelectItem value="recusado">Recusado</SelectItem>
              <SelectItem value="estornado">Estornado</SelectItem>
            </SelectContent>
          </Select>
          {canViewFinancials && <NewOrderDialog onCreated={refresh} create={create} />}
        </div>
      </header>

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
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Voucher</th>
                  <th className="text-left px-4 py-3">Data</th>
                  <th className="text-right px-4 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o) => (
                  <tr key={o.id} className="border-t border-admin-border hover:bg-admin-surface-2/60">
                    <td className="px-4 py-3">
                      <div className="text-admin-ink">{o.customer_name}</div>
                      {o.customer_email && <div className="text-xs text-admin-ink-muted">{o.customer_email}</div>}
                    </td>
                    <td className="px-4 py-3 text-admin-ink-soft">{o.service_title}</td>
                    {canViewFinancials && (
                      <td className="px-4 py-3 text-right tabular-nums">
                        € {(((o as { amount_cents?: number }).amount_cents ?? 0) / 100).toFixed(2)}
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Select value={o.payment_status} onValueChange={(v) => setStatus(o.id, v as never)}>
                        <SelectTrigger className={`h-7 px-2 text-xs uppercase tracking-wider w-32 border-0 ${STATUS_COLOR[o.payment_status]}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pendente">Pendente</SelectItem>
                          <SelectItem value="aprovado">Aprovado</SelectItem>
                          <SelectItem value="recusado">Recusado</SelectItem>
                          <SelectItem value="estornado">Estornado</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-4 py-3">
                      {o.voucher_code ? (
                        <button onClick={() => showVoucher(o.voucher_code!)} className="text-xs font-mono text-admin-accent hover:underline inline-flex items-center gap-1">
                          <QrCode className="h-3 w-3" /> {o.voucher_code}
                        </button>
                      ) : (
                        <span className="text-xs text-admin-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-admin-ink-muted">
                      {new Date(o.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!o.executed_at && o.payment_status === "aprovado" && (
                        <Button size="sm" variant="ghost" onClick={() => markExecuted(o.id)}>
                          <CheckCircle2 className="h-4 w-4" /> Executar
                        </Button>
                      )}
                      {o.executed_at && <span className="text-xs text-admin-success">✓ Executado</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </BentoCard>

      <Dialog open={!!voucherUrl} onOpenChange={(o) => !o && setVoucherUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Voucher {voucherCode}</DialogTitle>
          </DialogHeader>
          {voucherUrl && (
            <div className="flex flex-col items-center gap-3">
              <img src={voucherUrl} alt="QR Code" className="rounded-lg" />
              <a href={voucherUrl} download={`${voucherCode}.png`} className="text-sm text-admin-accent hover:underline">
                Baixar PNG
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewOrderDialog({ onCreated, create }: { onCreated: () => void; create: ReturnType<typeof useServerFn<typeof createOrder>> }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_name: "", customer_email: "", service_title: "", amount: "" });

  const submit = async () => {
    try {
      const cents = Math.round(parseFloat(form.amount || "0") * 100);
      await create({ data: { customer_name: form.customer_name, customer_email: form.customer_email, service_title: form.service_title, amount_cents: cents } });
      toast.success("Pedido criado");
      setForm({ customer_name: "", customer_email: "", service_title: "", amount: "" });
      setOpen(false);
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-admin-accent hover:bg-admin-accent/90"><Plus className="h-4 w-4" /> Novo pedido</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo pedido manual</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Cliente</Label><Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
          <div><Label>E-mail</Label><Input value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} /></div>
          <div><Label>Serviço</Label><Input value={form.service_title} onChange={(e) => setForm({ ...form, service_title: e.target.value })} placeholder="Tour Raiz, Vale Transporte..." /></div>
          <div><Label>Valor (€)</Label><Input type="number" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
          <Button onClick={submit} className="w-full bg-admin-accent hover:bg-admin-accent/90">Criar pedido</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
