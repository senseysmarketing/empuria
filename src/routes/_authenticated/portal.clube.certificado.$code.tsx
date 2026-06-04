import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCertificateByCode } from "@/lib/portal/clube-certificates.functions";
import { Award, Printer } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/clube/certificado/$code")({
  component: CertificatePage,
});

function CertificatePage() {
  const { code } = Route.useParams();
  const fetchCert = useServerFn(getCertificateByCode);
  const { data, isLoading } = useQuery({
    queryKey: ["cert", code],
    queryFn: () => fetchCert({ data: { code } }),
  });

  if (isLoading) {
    return <p className="text-admin-ink-muted p-12">Carregando…</p>;
  }
  const cert = data?.certificate;
  if (!cert) {
    return (
      <div className="p-12 text-center">
        <p className="font-display text-admin-ink">Certificado não encontrado.</p>
      </div>
    );
  }
  const date = new Date(cert.issued_at).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <div className="min-h-screen bg-offwhite p-6 md:p-12 print:p-0">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-end mb-4 print:hidden">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-orange-brand px-4 py-2 text-xs font-display uppercase tracking-wider text-white hover:bg-orange-brand/90"
          >
            <Printer className="h-4 w-4" /> Imprimir / PDF
          </button>
        </div>

        <article
          className="relative aspect-[1.414/1] overflow-hidden rounded-3xl border-[12px] border-yellow-brand bg-white text-brown-deep shadow-2xl print:shadow-none print:rounded-none print:border-[8px]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, oklch(0.95 0.05 75 / 0.4), transparent 50%), radial-gradient(circle at 80% 80%, oklch(0.95 0.05 45 / 0.3), transparent 50%)",
          }}
        >
          <div className="absolute inset-6 border-2 border-yellow-brand/40 rounded-2xl" />
          <div className="relative h-full w-full flex flex-col items-center justify-center px-10 text-center">
            <Award className="h-14 w-14 text-orange-brand mb-4" />
            <p className="text-[11px] uppercase tracking-[0.4em] font-display text-brown-deep/70">
              Instituto Empuria · Clube do Imigrante
            </p>
            <h1 className="font-display text-4xl md:text-6xl font-bold mt-3">
              Certificado
            </h1>
            <p className="mt-6 text-sm md:text-base font-body text-brown-deep/80 max-w-xl">
              Certificamos que
            </p>
            <p className="mt-2 font-display text-2xl md:text-4xl font-bold text-orange-brand">
              {cert.recipient_name}
            </p>
            <p className="mt-4 text-sm md:text-base font-body text-brown-deep/80 max-w-2xl">
              concluiu com êxito{" "}
              {cert.scope === "club"
                ? "todo o conteúdo do Clube do Imigrante"
                : `o módulo "${cert.module_title ?? "Clube do Imigrante"}"`}
              , consolidando seu preparo para viver e empreender na Espanha.
            </p>
            <div className="mt-10 flex items-center gap-12">
              <div>
                <p className="text-xs font-body text-brown-deep/60">Emitido em</p>
                <p className="font-display text-sm font-bold">{date}</p>
              </div>
              <div>
                <p className="text-xs font-body text-brown-deep/60">Código</p>
                <p className="font-display text-sm font-bold tracking-wider">{cert.code}</p>
              </div>
            </div>
          </div>
        </article>
      </div>
    </div>
  );
}
