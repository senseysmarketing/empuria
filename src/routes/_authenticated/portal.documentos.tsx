import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Download, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BentoCard } from "@/components/admin/BentoCard";
import { Button } from "@/components/ui/button";
import {
  listMyMemberDocuments,
  prepareMemberDocumentUpload,
  finalizeMemberDocumentUpload,
  getMemberDocumentDownload,
} from "@/lib/member-documents.functions";
import { resolveMemberMimeType } from "@/lib/member-documents.security";

export const Route = createFileRoute("/_authenticated/portal/documentos")({
  component: PortalDocumentsPage,
});

type DocumentRow = Awaited<ReturnType<typeof listMyMemberDocuments>>[number];

function PortalDocumentsPage() {
  const list = useServerFn(listMyMemberDocuments);
  const prepare = useServerFn(prepareMemberDocumentUpload);
  const finalize = useServerFn(finalizeMemberDocumentUpload);
  const download = useServerFn(getMemberDocumentDownload);
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const selectedDocument = useRef<string | null>(null);
  const query = useQuery({ queryKey: ["my-member-documents"], queryFn: () => list() });

  const upload = useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }) => {
      const mimeType = resolveMemberMimeType(file.name, file.type);
      const spec = {
        documentId,
        fileName: file.name,
        mimeType,
        fileSizeBytes: file.size,
      };
      const signed = await prepare({ data: spec });
      const { error } = await supabase.storage
        .from("member-documents")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: mimeType,
          upsert: false,
        });
      if (error) throw new Error(error.message);
      await finalize({ data: { ...spec, path: signed.path } });
    },
    onSuccess: () => {
      toast.success("Documento recebido. A equipe fará a análise.");
      qc.invalidateQueries({ queryKey: ["my-member-documents"] });
      qc.invalidateQueries({ queryKey: ["portal-dashboard"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const downloadMutation = useMutation({
    mutationFn: (documentId: string) => download({ data: { documentId } }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const docs = query.data ?? [];
  const groups = [
    {
      title: "Preciso enviar",
      docs: docs.filter((d) => d.status === "requested" || d.status === "needs_replacement"),
    },
    { title: "Em análise", docs: docs.filter((d) => d.status === "received") },
    { title: "Aprovados", docs: docs.filter((d) => d.status === "approved") },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-4xl font-bold text-admin-ink">Meus documentos</h1>
        <p className="mt-1 text-sm text-admin-ink-muted">
          Envie os documentos solicitados e acompanhe a análise da equipe.
        </p>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const documentId = selectedDocument.current;
          if (file && documentId) upload.mutate({ documentId, file });
          event.target.value = "";
        }}
      />
      {query.isLoading ? (
        <p className="text-sm text-admin-ink-muted">Carregando documentos…</p>
      ) : query.error ? (
        <p className="text-sm text-red-600">
          Não foi possível carregar os documentos: {query.error.message}
        </p>
      ) : (
        groups.map((group) => (
          <BentoCard key={group.title} title={group.title} padded>
            {group.docs.length === 0 ? (
              <p className="text-sm text-admin-ink-muted">Nenhum documento nesta etapa.</p>
            ) : (
              <div className="space-y-3">
                {group.docs.map((doc) => (
                  <DocumentItem
                    key={doc.id}
                    doc={doc}
                    busy={upload.isPending || downloadMutation.isPending}
                    onUpload={() => {
                      selectedDocument.current = doc.id;
                      fileInput.current?.click();
                    }}
                    onDownload={() => downloadMutation.mutate(doc.id)}
                  />
                ))}
              </div>
            )}
          </BentoCard>
        ))
      )}
    </div>
  );
}

function DocumentItem({
  doc,
  busy,
  onUpload,
  onDownload,
}: {
  doc: DocumentRow;
  busy: boolean;
  onUpload: () => void;
  onDownload: () => void;
}) {
  const needsUpload = doc.status === "requested" || doc.status === "needs_replacement";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-admin-border bg-admin-bg p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-admin-accent" />
        <div className="min-w-0">
          <p className="font-display text-sm text-admin-ink">{doc.title}</p>
          {doc.category && <p className="text-xs text-admin-ink-muted">{doc.category}</p>}
          {doc.member_message && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-admin-ink-muted">
              {doc.member_message}
            </p>
          )}
          {doc.status === "needs_replacement" && (
            <p className="mt-1 text-xs text-amber-700">A equipe pediu um novo arquivo.</p>
          )}
          {doc.file_name && (
            <p className="mt-1 truncate text-xs text-admin-ink-muted">Arquivo: {doc.file_name}</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {doc.file_name && (
          <Button variant="outline" size="sm" disabled={busy} onClick={onDownload}>
            <Download className="mr-1 h-4 w-4" /> Baixar
          </Button>
        )}
        {needsUpload && (
          <Button size="sm" disabled={busy} onClick={onUpload}>
            <Upload className="mr-1 h-4 w-4" /> {doc.file_name ? "Substituir" : "Enviar"}
          </Button>
        )}
      </div>
    </div>
  );
}
