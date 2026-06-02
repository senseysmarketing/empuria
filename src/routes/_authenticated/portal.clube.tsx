import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getClubContent } from "@/lib/portal/clube.functions";
import { ClubCarousel } from "@/components/portal/ClubCarousel";
import { VideoPlayerModal, type ClubVideo } from "@/components/portal/VideoPlayerModal";
import { GridSkeleton } from "@/components/portal/PortalSkeleton";
import { ArrowRight, Clock, Crown, Lock, MessageCircle, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/clube")({
  component: ClubePage,
});

function ClubePage() {
  const fetchContent = useServerFn(getClubContent);
  const { data, isLoading } = useQuery({
    queryKey: ["club-content"],
    queryFn: () => fetchContent(),
  });
  const [selected, setSelected] = useState<ClubVideo | null>(null);

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-admin-accent-soft text-admin-accent">
            <Crown className="h-6 w-6" />
          </div>
          <div>
            <h1 className="font-display text-4xl font-bold tracking-tight">Clube do Imigrante</h1>
            <p className="mt-1 text-sm text-admin-ink-muted font-body">
              Conteudo exclusivo: mentalidade, passos iniciais e cultura espanhola.
            </p>
          </div>
        </div>
        {data?.isMember && data.hubla.whatsappGroupUrl && (
          <a
            href={data.hubla.whatsappGroupUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 font-display text-xs uppercase tracking-wider text-white hover:bg-emerald-700"
          >
            <MessageCircle className="h-4 w-4" /> Acessar grupo WhatsApp
          </a>
        )}
      </header>

      {!isLoading && !data?.isMember && (
        <ClubAccessPanel
          subscription={data?.subscription ?? null}
          checkoutUrl={data?.hubla.checkoutUrl ?? null}
          isHublaEnabled={!!data?.hubla.isEnabled}
        />
      )}

      {isLoading ? (
        <GridSkeleton />
      ) : !data || data.modules.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-admin-border p-12 text-center">
          <p className="font-display text-admin-ink-soft">Conteudo chegando em breve.</p>
        </div>
      ) : (
        <div className="space-y-10">
          {data.modules.map((m) => (
            <ClubCarousel
              key={m.module}
              title={m.module}
              items={m.items}
              locked={!data.isMember}
              onSelect={(v) => setSelected(v)}
            />
          ))}
        </div>
      )}

      <VideoPlayerModal
        video={selected}
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

function ClubAccessPanel({
  subscription,
  checkoutUrl,
  isHublaEnabled,
}: {
  subscription: {
    status?: string | null;
    access_status?: string | null;
    current_period_end?: string | null;
  } | null;
  checkoutUrl: string | null;
  isHublaEnabled: boolean;
}) {
  const status = subscription?.access_status ?? "none";
  const isPending = status === "pending";
  const isInactive = status === "inactive";
  const title = isPending
    ? "Assinatura em processamento"
    : isInactive
      ? "Acesso do Clube inativo"
      : "Conteudos bloqueados";
  const body = isPending
    ? "Recebemos seu cadastro. O acesso sera liberado automaticamente quando o webhook da Hubla confirmar a assinatura."
    : isInactive
      ? "A Hubla informou que sua assinatura nao esta ativa. Regularize pelo checkout usando o mesmo e-mail do portal."
      : "Voce esta vendo a vitrine. Assine o Clube pela Hubla usando o mesmo e-mail cadastrado no Instituto Empuria.";

  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface-2 p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-3">
          <div className="mt-0.5">
            {isPending ? (
              <Clock className="h-5 w-5 text-amber-600" />
            ) : isInactive ? (
              <ShieldAlert className="h-5 w-5 text-red-700" />
            ) : (
              <Lock className="h-5 w-5 text-admin-ink-muted" />
            )}
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold text-admin-ink">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-admin-ink-soft font-body">{body}</p>
            <p className="mt-2 text-xs text-admin-ink-muted">
              O redirect pos-compra nao libera acesso sozinho; a confirmacao vem pela Hubla.
            </p>
          </div>
        </div>
        {checkoutUrl && isHublaEnabled ? (
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-orange-brand px-5 py-3 font-display text-xs uppercase tracking-wider text-offwhite hover:bg-red-brand"
          >
            {isInactive ? "Regularizar na Hubla" : "Assinar Clube"}
            <ArrowRight className="h-4 w-4" />
          </a>
        ) : (
          <span className="rounded-lg border border-admin-border px-4 py-3 text-xs text-admin-ink-muted">
            Checkout indisponivel
          </span>
        )}
      </div>
    </div>
  );
}
