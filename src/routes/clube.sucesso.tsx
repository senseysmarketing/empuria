import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, Clock, Crown } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

export const Route = createFileRoute("/clube/sucesso")({
  component: ClubeSucessoPage,
});

function ClubeSucessoPage() {
  return (
    <div className="min-h-screen bg-offwhite text-brown">
      <SiteHeader />
      <main className="px-6 py-24">
        <section className="mx-auto max-w-2xl text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-brand/20 text-orange-brand">
            <Crown className="h-8 w-8" />
          </div>
          <h1 className="mt-6 font-display text-4xl font-extrabold uppercase leading-tight">
            Pagamento em processamento
          </h1>
          <p className="mt-4 font-body text-lg leading-relaxed text-brown-deep/80">
            Recebemos seu retorno da Hubla. Assim que a assinatura for confirmada pelo webhook, seu
            acesso ao Clube do Imigrante sera liberado automaticamente no portal.
          </p>
          <div className="mt-8 rounded-xl border border-brown/10 bg-white p-5 text-left shadow-sm">
            <div className="flex gap-3">
              <Clock className="mt-0.5 h-5 w-5 shrink-0 text-orange-brand" />
              <div>
                <h2 className="font-display text-sm uppercase tracking-widest text-brown">
                  Importante
                </h2>
                <p className="mt-1 font-body text-sm text-brown-deep/75">
                  Esta pagina nao libera o acesso sozinha. A liberacao acontece quando a Hubla envia
                  a confirmacao oficial para o Instituto Empuria.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              to="/portal/clube"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-orange-brand px-7 py-4 font-display text-sm font-bold uppercase tracking-widest text-offwhite hover:bg-red-brand"
            >
              <CheckCircle2 className="h-4 w-4" /> Ir para o portal
            </Link>
            <Link
              to="/login"
              search={{ redirect: "/portal/clube" }}
              className="inline-flex items-center justify-center rounded-md border border-brown/20 px-7 py-4 font-display text-sm font-bold uppercase tracking-widest text-brown hover:bg-brown/5"
            >
              Entrar no portal
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
