import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMyServices,
  toggleOrderDocument,
  markDocumentsReady,
} from "@/lib/portal/services.functions";
import { Plane, MapPin, CreditCard, Landmark, Users, MessageCircle, MapPinned, QrCode, Bell, Check } from "lucide-react";
import { useState, useEffect } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";

type Order = ReturnType<typeof useQuery<Awaited<ReturnType<typeof getMyServices>>>>["data"] extends infer T
  ? T extends { orders: infer O } ? O extends Array<infer I> ? I : never : never
  : never;

const KIND_ICON = {
  airport: Plane, tour: MapPin, consulting: CreditCard, banking: Landmark, meeting: Users,
} as const;

export function MyServicesPanel() {
  const fetchMy = useServerFn(getMyServices);
  const { data, isLoading } = useQuery({
    queryKey: ["my-services"],
    queryFn: () => fetchMy(),
  });

  if (isLoading) return <p className="text-offwhite/60">Carregando seus serviços...</p>;
  if (!data || data.orders.length === 0) {
    return (
      <div className="bg-brown-dark/60 border border-yellow-brand/20 rounded-xl p-6 text-center">
        <p className="text-offwhite/60 font-body">
          Você ainda não contratou nenhum serviço. Visite a vitrine para começar.
        </p>
      </div>
    );
  }

  const paid = data.orders.filter((o) => o.payment_status === "aprovado");
  const pending = data.orders.filter((o) => o.payment_status !== "aprovado");

  return (
    <div className="space-y-6">
      {paid.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {paid.map((order) => (
            <ServiceDeliveryCard
              key={order.id}
              order={order}
              services={data.services}
              slots={data.slots}
              hosts={data.hosts}
              documents={data.documents}
            />
          ))}
        </div>
      )}
      {pending.length > 0 && (
        <div className="bg-brown-dark/60 border border-yellow-brand/10 rounded-xl p-4">
          <div className="text-yellow-brand text-[10px] uppercase tracking-widest font-display mb-2">
            Aguardando pagamento
          </div>
          <ul className="space-y-1 text-sm text-offwhite/70">
            {pending.map((o) => (
              <li key={o.id}>{o.service_title} · € {(o.amount_cents / 100).toFixed(2)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ServiceDeliveryCard({
  order,
  services,
  slots,
  hosts,
  documents,
}: {
  order: NonNullable<Awaited<ReturnType<typeof getMyServices>>>["orders"][number];
  services: NonNullable<Awaited<ReturnType<typeof getMyServices>>>["services"];
  slots: NonNullable<Awaited<ReturnType<typeof getMyServices>>>["slots"];
  hosts: NonNullable<Awaited<ReturnType<typeof getMyServices>>>["hosts"];
  documents: NonNullable<Awaited<ReturnType<typeof getMyServices>>>["documents"];
}) {
  const service = services.find((s) => s.id === order.service_id);
  const slot = slots.find((s) => s.id === order.slot_id);
  const host = hosts.find((h) => h.id === order.host_profile_id);
  const orderDocs = documents.filter((d) => d.order_id === order.id);
  const Icon = service ? KIND_ICON[service.kind as keyof typeof KIND_ICON] : Check;

  const qc = useQueryClient();
  const toggle = useServerFn(toggleOrderDocument);
  const markReady = useServerFn(markDocumentsReady);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const meta = (order.service_metadata as Record<string, unknown>) ?? {};

  useEffect(() => {
    if (service?.kind === "tour" && order.voucher_code) {
      QRCode.toDataURL(order.voucher_code, { width: 160, margin: 1 }).then(setQrUrl);
    }
  }, [service?.kind, order.voucher_code]);

  // Reminder 24h
  useEffect(() => {
    if (service?.kind !== "meeting" || !slot) return;
    const diff = new Date(slot.starts_at).getTime() - Date.now();
    if (diff > 0 && diff < 1000 * 60 * 60 * 24) {
      const key = `reminder-${order.id}`;
      if (!sessionStorage.getItem(key)) {
        toast.info(`Reunião amanhã às ${new Date(slot.starts_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}!`);
        sessionStorage.setItem(key, "1");
      }
    }
  }, [order.id, service?.kind, slot]);

  return (
    <div className="bg-offwhite text-brown-deep rounded-xl p-5 shadow-warm border border-yellow-brand/10">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-brand/10 text-orange-brand flex items-center justify-center">
            <Icon className="w-5 h-5" strokeWidth={1.7} />
          </div>
          <div>
            <h3 className="font-display font-bold uppercase tracking-tight text-base text-brown">{order.service_title}</h3>
            {order.voucher_code && (
              <code className="text-[10px] font-mono text-brown-deep/50">{order.voucher_code}</code>
            )}
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-widest font-display px-2 py-1 rounded bg-green-100 text-green-800">
          Confirmado
        </span>
      </div>

      {/* Airport */}
      {service?.kind === "airport" && (
        <div className="space-y-3 text-sm">
          <div className="bg-muted/50 rounded p-3 font-body">
            <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50">Voo</div>
            <div>{String(meta.flightNumber ?? "—")} · {String(meta.arrivalDate ?? "")} {String(meta.arrivalTime ?? "")}</div>
            <div className="text-xs text-brown-deep/60">Terminal {String(meta.terminal ?? "—")} · {String(meta.bagsCount ?? 0)} mala(s)</div>
          </div>
          {host ? (
            <div className="flex items-center gap-3">
              {host.avatar_url ? (
                <img src={host.avatar_url} alt={host.full_name ?? ""} className="w-12 h-12 rounded-full object-cover" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-orange-brand/20 flex items-center justify-center font-display text-orange-brand">
                  {(host.full_name ?? "?")[0]}
                </div>
              )}
              <div className="flex-1">
                <div className="font-display text-sm text-brown">{host.full_name}</div>
                <div className="text-xs text-brown-deep/60">Seu anfitrião no aeroporto</div>
              </div>
              {host.phone && (
                <a
                  href={`https://wa.me/${host.phone.replace(/\D/g, "")}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded text-xs font-display uppercase tracking-wider"
                >
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </a>
              )}
            </div>
          ) : (
            <p className="text-xs text-brown-deep/60 italic">Anfitrião será designado em breve.</p>
          )}
        </div>
      )}

      {/* Tour */}
      {service?.kind === "tour" && slot && (
        <div className="space-y-3 text-sm">
          <div className="bg-muted/50 rounded p-3">
            <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50">Encontro</div>
            <div className="font-body">{service.meeting_address}</div>
            <div className="text-xs text-brown-deep/60 mt-1">
              {new Date(slot.starts_at).toLocaleString("pt-BR")}
            </div>
          </div>
          {qrUrl && (
            <div className="flex items-center gap-3">
              <img src={qrUrl} alt="QR" className="w-20 h-20 rounded border border-border" />
              <div className="text-xs text-brown-deep/70 font-body">
                <div className="flex items-center gap-1 font-display uppercase tracking-wider text-orange-brand text-[10px] mb-1">
                  <QrCode className="h-3 w-3" /> Check-in
                </div>
                Apresente este QR Code no ponto de encontro.
              </div>
            </div>
          )}
          <ul className="text-xs text-brown-deep/70 space-y-1">
            <li className="flex gap-1"><Check className="h-3 w-3 text-orange-brand mt-0.5" /> Use tênis confortável</li>
            <li className="flex gap-1"><Check className="h-3 w-3 text-orange-brand mt-0.5" /> Leve água e documento</li>
          </ul>
        </div>
      )}

      {/* Consulting (vale transporte) */}
      {service?.kind === "consulting" && (
        <div className="space-y-3 text-sm">
          <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50">Documentos necessários</div>
          <ul className="space-y-2">
            {orderDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={async (e) => {
                    await toggle({ data: { id: d.id, checked: e.target.checked } });
                    qc.invalidateQueries({ queryKey: ["my-services"] });
                  }}
                  className="rounded accent-orange-brand"
                />
                <span className={d.checked ? "line-through text-brown-deep/40" : ""}>{d.label}</span>
              </li>
            ))}
          </ul>
          {orderDocs.length > 0 && orderDocs.every((d) => d.checked) && order.delivery_status === "aguardando_documentos" && (
            <button
              onClick={async () => {
                await markReady({ data: { orderId: order.id } });
                toast.success("Notificamos o time. Em breve faremos contato.");
                qc.invalidateQueries({ queryKey: ["my-services"] });
              }}
              className="w-full bg-orange-brand text-offwhite py-2.5 rounded text-xs font-display uppercase tracking-wider hover:bg-red-brand"
            >
              Documentos em mãos? Prosseguir
            </button>
          )}
          {order.delivery_status === "processando" && (
            <p className="text-xs text-orange-brand font-display uppercase tracking-wider">Em atendimento</p>
          )}
        </div>
      )}

      {/* Banking */}
      {service?.kind === "banking" && (
        <div className="space-y-3 text-sm">
          <BankingProgress status={order.delivery_status} />
          <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50 pt-2">Checklist</div>
          <ul className="space-y-2">
            {orderDocs.map((d) => (
              <li key={d.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={d.checked}
                  onChange={async (e) => {
                    await toggle({ data: { id: d.id, checked: e.target.checked } });
                    qc.invalidateQueries({ queryKey: ["my-services"] });
                  }}
                  className="rounded accent-orange-brand"
                />
                <span className={d.checked ? "line-through text-brown-deep/40" : ""}>{d.label}</span>
              </li>
            ))}
          </ul>
          {order.delivery_status === "concluido" && service.meeting_address && (
            <div className="bg-green-50 border border-green-200 rounded p-3 text-xs">
              <div className="font-display uppercase tracking-wider text-green-800 text-[10px] mb-1">Agência confirmada</div>
              {service.meeting_address}
            </div>
          )}
        </div>
      )}

      {/* Meeting */}
      {service?.kind === "meeting" && slot && (
        <div className="space-y-3 text-sm">
          <div className="bg-muted/50 rounded p-3">
            <div className="text-[10px] uppercase tracking-widest font-display text-brown-deep/50">Agendado para</div>
            <div className="font-display text-base text-brown">
              {new Date(slot.starts_at).toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div className="text-xs text-brown-deep/60 mt-1">{service.meeting_address}</div>
          </div>
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(service.meeting_address ?? "")}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-display uppercase tracking-wider text-orange-brand hover:text-red-brand"
          >
            <MapPinned className="h-3 w-3" /> Como chegar
          </a>
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-display text-brown-deep/50">
            <Bell className="h-3 w-3" /> Lembrete automático 24h antes
          </div>
        </div>
      )}
    </div>
  );
}

function BankingProgress({ status }: { status: string }) {
  const steps = [
    { key: "aguardando_documentos", label: "Recebimento" },
    { key: "processando", label: "Tratativa Bancária" },
    { key: "agendado", label: "Agendamento" },
    { key: "concluido", label: "Concluído" },
  ];
  const idx = steps.findIndex((s) => s.key === status);
  return (
    <div className="flex gap-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex-1">
          <div className={`h-1.5 rounded ${i <= idx ? "bg-orange-brand" : "bg-muted"}`} />
          <div className={`text-[9px] uppercase tracking-wider mt-1 font-display ${i <= idx ? "text-orange-brand" : "text-brown-deep/40"}`}>
            {s.label}
          </div>
        </div>
      ))}
    </div>
  );
}
