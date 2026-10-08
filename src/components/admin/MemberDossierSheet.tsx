import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, FilePlus2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  getMemberDossier,
  MEMBER_STATUS,
  updateMemberStatus,
} from "@/lib/admin/member-dossier.functions";
import { updateUserProfile } from "@/lib/admin/usuarios.functions";
import {
  requestMemberDocument,
  updateMemberDocument,
  reviewMemberDocument,
  prepareMemberDocumentUpload,
  finalizeMemberDocumentUpload,
  getMemberDocumentDownload,
  deleteMemberDocument,
} from "@/lib/member-documents.functions";
import { resolveMemberMimeType } from "@/lib/member-documents.security";

const statusLabels: Record<string, string> = {
  novo: "Novo",
  em_atendimento: "Em atendimento",
  aguardando_documentos: "Aguardando documentos",
  em_andamento: "Em andamento",
  aguardando_cliente: "Aguardando cliente",
  concluido: "Concluído",
  inativo: "Inativo",
};

type Dossier = Awaited<ReturnType<typeof getMemberDossier>>;
type Document = Dossier["documents"][number];
type AccessAction = "edit" | "block" | "reset" | "email" | "impersonate";

export function MemberDossierSheet({
  userId,
  open,
  onClose,
  onChanged,
  onAccess,
}: {
  userId: string;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  onAccess: (action: AccessAction) => void;
}) {
  const getDossier = useServerFn(getMemberDossier);
  const saveStatus = useServerFn(updateMemberStatus);
  const saveProfile = useServerFn(updateUserProfile);
  const requestDoc = useServerFn(requestMemberDocument);
  const editDoc = useServerFn(updateMemberDocument);
  const reviewDoc = useServerFn(reviewMemberDocument);
  const prepareUpload = useServerFn(prepareMemberDocumentUpload);
  const finalizeUpload = useServerFn(finalizeMemberDocumentUpload);
  const getDownload = useServerFn(getMemberDocumentDownload);
  const deleteDoc = useServerFn(deleteMemberDocument);
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [nextStep, setNextStep] = useState("");
  const [notes, setNotes] = useState("");
  const [requestTitle, setRequestTitle] = useState("");
  const [requestCategory, setRequestCategory] = useState("");
  const [requestOrderId, setRequestOrderId] = useState("");
  const [requestVisible, setRequestVisible] = useState(true);
  const [requestMessage, setRequestMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadDocId = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ["member-dossier", userId],
    queryFn: () => getDossier({ data: { userId } }),
    enabled: open,
  });
  const dossier = query.data;
  useEffect(() => {
    if (dossier) {
      setStatus(dossier.profile.member_status);
      setNextStep(dossier.profile.member_next_step ?? "");
      setNotes(dossier.profile.admin_notes ?? "");
    }
  }, [dossier]);
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["member-dossier", userId] });
    onChanged();
  };
  const statusMut = useMutation({
    mutationFn: () =>
      saveStatus({
        data: {
          userId,
          status: (status ||
            dossier?.profile.member_status ||
            "novo") as (typeof MEMBER_STATUS)[number],
          nextStep: nextStep.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Situação atualizada");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const notesMut = useMutation({
    mutationFn: () => saveProfile({ data: { id: userId, admin_notes: notes.trim() || null } }),
    onSuccess: () => {
      toast.success("Notas salvas");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const requestMut = useMutation({
    mutationFn: () =>
      requestDoc({
        data: {
          userId,
          title: requestTitle.trim(),
          category: requestCategory.trim() || null,
          orderId: requestOrderId || null,
          visibleToMember: requestVisible,
          memberMessage: requestMessage.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success("Documento solicitado");
      setRequestTitle("");
      setRequestCategory("");
      setRequestMessage("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const uploadMut = useMutation({
    mutationFn: async ({ documentId, file }: { documentId: string; file: File }) => {
      const mimeType = resolveMemberMimeType(file.name, file.type);
      const spec = {
        documentId,
        fileName: file.name,
        mimeType,
        fileSizeBytes: file.size,
      };
      const signed = await prepareUpload({ data: spec });
      const { error } = await supabase.storage
        .from("member-documents")
        .uploadToSignedUrl(signed.path, signed.token, file, {
          contentType: mimeType,
          upsert: false,
        });
      if (error) throw new Error(error.message);
      await finalizeUpload({ data: { ...spec, path: signed.path } });
    },
    onSuccess: () => {
      toast.success("Arquivo enviado");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const reviewMut = useMutation({
    mutationFn: (input: { documentId: string; status: "approved" | "needs_replacement" }) =>
      reviewDoc({ data: input }),
    onSuccess: () => {
      toast.success("Documento revisado");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const editMut = useMutation({
    mutationFn: (input: {
      documentId: string;
      title: string;
      category: string | null;
      orderId: string | null;
      visibleToMember: boolean;
      memberMessage: string | null;
      adminNotes: string | null;
    }) => editDoc({ data: input }),
    onSuccess: () => {
      toast.success("Documento atualizado");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (documentId: string) => deleteDoc({ data: { documentId } }),
    onSuccess: () => {
      toast.success("Documento excluído");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const downloadMut = useMutation({
    mutationFn: (documentId: string) => getDownload({ data: { documentId } }),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent className="w-full overflow-y-auto border-admin-border bg-admin-surface text-admin-ink sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Dossiê do membro</SheetTitle>
        </SheetHeader>
        {query.isLoading ? (
          <p className="py-8 text-sm">Carregando dossiê…</p>
        ) : query.error ? (
          <p className="py-8 text-sm text-red-600">{query.error.message}</p>
        ) : (
          dossier && (
            <Tabs defaultValue="resumo" className="mt-5">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="resumo">Resumo</TabsTrigger>
                <TabsTrigger value="servicos">Serviços</TabsTrigger>
                <TabsTrigger value="documentos">Documentos</TabsTrigger>
                <TabsTrigger value="acesso">Acesso</TabsTrigger>
              </TabsList>
              <TabsContent value="resumo" className="space-y-5 py-4">
                <div className="rounded-xl border border-admin-border bg-admin-bg p-4 text-sm">
                  <p className="font-display text-lg">{dossier.profile.full_name ?? "Sem nome"}</p>
                  <p>
                    {dossier.email ?? "Sem e-mail"} · {dossier.profile.phone ?? "Sem telefone"}
                  </p>
                  <p className="mt-2 text-admin-ink-muted">
                    Cadastro: {new Date(dossier.profile.created_at).toLocaleDateString("pt-BR")}
                    {" · "}Último acesso:{" "}
                    {dossier.lastSignInAt
                      ? new Date(dossier.lastSignInAt).toLocaleString("pt-BR")
                      : "Nunca"}
                  </p>
                  <p className="mt-1">
                    {dossier.profile.is_blocked ? "Conta bloqueada" : "Conta ativa"}
                  </p>
                  <Button
                    className="mt-3"
                    variant="outline"
                    size="sm"
                    onClick={() => onAccess("edit")}
                  >
                    Editar nome e telefone
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Situação do atendimento</Label>
                  <select
                    className="h-10 w-full rounded-md border border-admin-border bg-admin-bg px-3 text-sm"
                    value={status || dossier.profile.member_status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    {MEMBER_STATUS.map((value) => (
                      <option key={value} value={value}>
                        {statusLabels[value]}
                      </option>
                    ))}
                  </select>
                  <Label>Próximo passo</Label>
                  <Textarea
                    value={nextStep}
                    onChange={(e) => setNextStep(e.target.value)}
                    placeholder="Deixe vazio se ainda não houver orientação."
                    className="min-h-24"
                  />
                  <Button disabled={statusMut.isPending} onClick={() => statusMut.mutate()}>
                    Salvar situação
                  </Button>
                </div>
                <div className="space-y-2">
                  <Label>Notas internas — nunca visíveis no Portal</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-24"
                  />
                  <Button
                    variant="outline"
                    disabled={notesMut.isPending}
                    onClick={() => notesMut.mutate()}
                  >
                    Salvar notas
                  </Button>
                </div>
              </TabsContent>
              <TabsContent value="servicos" className="space-y-3 py-4">
                {dossier.orders.length === 0 && (
                  <p className="text-sm text-admin-ink-muted">Nenhum serviço contratado.</p>
                )}
                {dossier.orders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-admin-border p-4 text-sm">
                    <p className="font-display">{order.service_title}</p>
                    <p className="text-admin-ink-muted">
                      {new Date(order.created_at).toLocaleDateString("pt-BR")} ·{" "}
                      {order.payment_status}
                      {" · "}
                      {order.delivery_status}
                    </p>
                    <p className="mt-1">
                      {order.currency} {(order.amount_cents / 100).toFixed(2)}
                    </p>
                    {dossier.appointments
                      .filter((appointment) => appointment.service_id === order.service_id)
                      .slice(0, 1)
                      .map((appointment) => (
                        <p key={appointment.id} className="mt-1 text-xs text-admin-ink-muted">
                          Compromisso: {new Date(appointment.starts_at).toLocaleString("pt-BR")}
                        </p>
                      ))}
                  </div>
                ))}
                {dossier.appointments.length > 0 && (
                  <p className="text-xs text-admin-ink-muted">
                    Próximo compromisso:{" "}
                    {new Date(dossier.appointments[0].starts_at).toLocaleString("pt-BR")}
                  </p>
                )}
              </TabsContent>
              <TabsContent value="documentos" className="space-y-5 py-4">
                <input
                  ref={fileInput}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file && uploadDocId.current)
                      uploadMut.mutate({ documentId: uploadDocId.current, file });
                    event.target.value = "";
                  }}
                />
                <div className="space-y-2 rounded-xl border border-admin-border bg-admin-bg p-4">
                  <p className="font-display">Solicitar documento</p>
                  <Input
                    placeholder="Título"
                    value={requestTitle}
                    onChange={(e) => setRequestTitle(e.target.value)}
                  />
                  <Input
                    placeholder="Categoria (opcional)"
                    value={requestCategory}
                    onChange={(e) => setRequestCategory(e.target.value)}
                  />
                  <select
                    className="h-10 w-full rounded-md border border-admin-border bg-admin-surface px-3 text-sm"
                    value={requestOrderId}
                    onChange={(e) => setRequestOrderId(e.target.value)}
                  >
                    <option value="">Sem serviço vinculado</option>
                    {dossier.orders.map((order) => (
                      <option key={order.id} value={order.id}>
                        {order.service_title}
                      </option>
                    ))}
                  </select>
                  <Textarea
                    placeholder="Mensagem para o membro (opcional)"
                    value={requestMessage}
                    onChange={(e) => setRequestMessage(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={requestVisible}
                      onChange={(e) => setRequestVisible(e.target.checked)}
                    />
                    Visível ao membro
                  </label>
                  <Button
                    disabled={!requestTitle.trim() || requestMut.isPending}
                    onClick={() => requestMut.mutate()}
                  >
                    <FilePlus2 className="mr-1 h-4 w-4" /> Solicitar
                  </Button>
                </div>
                {dossier.documents.length === 0 && (
                  <p className="text-sm text-admin-ink-muted">Nenhum documento cadastrado.</p>
                )}
                {dossier.documents.map((doc) => (
                  <DocumentEditor
                    key={doc.id}
                    doc={doc}
                    orders={dossier.orders}
                    busy={
                      editMut.isPending ||
                      reviewMut.isPending ||
                      uploadMut.isPending ||
                      deleteMut.isPending
                    }
                    onSave={(input) => editMut.mutate(input)}
                    onReview={(status) => reviewMut.mutate({ documentId: doc.id, status })}
                    onUpload={() => {
                      uploadDocId.current = doc.id;
                      fileInput.current?.click();
                    }}
                    onDownload={() => downloadMut.mutate(doc.id)}
                    onDelete={() => {
                      if (window.confirm(`Excluir "${doc.title}" e seu arquivo permanentemente?`))
                        deleteMut.mutate(doc.id);
                    }}
                  />
                ))}
              </TabsContent>
              <TabsContent value="acesso" className="space-y-3 py-4">
                <p className="text-sm text-admin-ink-muted">
                  Ações de conta existentes, preservadas com os mesmos controles de acesso.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onAccess("block")}>
                    {dossier.profile.is_blocked ? "Desbloquear" : "Bloquear"}
                  </Button>
                  <Button variant="outline" onClick={() => onAccess("reset")}>
                    Resetar senha
                  </Button>
                  <Button variant="outline" onClick={() => onAccess("email")}>
                    Alterar e-mail
                  </Button>
                  <Button variant="outline" onClick={() => onAccess("impersonate")}>
                    Acessar como membro
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          )
        )}
      </SheetContent>
    </Sheet>
  );
}

function DocumentEditor({
  doc,
  orders,
  busy,
  onSave,
  onReview,
  onUpload,
  onDownload,
  onDelete,
}: {
  doc: Document;
  orders: Dossier["orders"];
  busy: boolean;
  onSave: (input: {
    documentId: string;
    title: string;
    category: string | null;
    orderId: string | null;
    visibleToMember: boolean;
    memberMessage: string | null;
    adminNotes: string | null;
  }) => void;
  onReview: (status: "approved" | "needs_replacement") => void;
  onUpload: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(doc.title);
  const [category, setCategory] = useState(doc.category ?? "");
  const [orderId, setOrderId] = useState(doc.order_id ?? "");
  const [visible, setVisible] = useState(doc.visible_to_member);
  const [message, setMessage] = useState(doc.member_message ?? "");
  const [adminNotes, setAdminNotes] = useState(doc.admin_notes ?? "");
  return (
    <div className="space-y-2 rounded-xl border border-admin-border p-4 text-sm">
      <p className="text-xs uppercase tracking-wider text-admin-ink-muted">
        {doc.status.replaceAll("_", " ")} · {new Date(doc.updated_at).toLocaleString("pt-BR")}
      </p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} />
      <Input
        placeholder="Categoria"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      />
      <select
        className="h-10 w-full rounded-md border border-admin-border bg-admin-bg px-3"
        value={orderId}
        onChange={(e) => setOrderId(e.target.value)}
      >
        <option value="">Sem serviço vinculado</option>
        {orders.map((order) => (
          <option key={order.id} value={order.id}>
            {order.service_title}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} />
        Visível ao membro
      </label>
      <Textarea
        placeholder="Mensagem para o membro"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <Textarea
        placeholder="Notas internas"
        value={adminNotes}
        onChange={(e) => setAdminNotes(e.target.value)}
      />
      {doc.file_name && (
        <p className="truncate text-xs text-admin-ink-muted">Arquivo: {doc.file_name}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !title.trim()}
          onClick={() =>
            onSave({
              documentId: doc.id,
              title: title.trim(),
              category: category.trim() || null,
              orderId: orderId || null,
              visibleToMember: visible,
              memberMessage: message.trim() || null,
              adminNotes: adminNotes.trim() || null,
            })
          }
        >
          Salvar
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onUpload}>
          <Upload className="mr-1 h-4 w-4" /> {doc.file_name ? "Substituir" : "Enviar"}
        </Button>
        {doc.file_name && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onDownload}>
            <Download className="mr-1 h-4 w-4" /> Baixar
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !doc.file_name}
          onClick={() => onReview("approved")}
        >
          Aprovar
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onReview("needs_replacement")}
        >
          Pedir substituição
        </Button>
        <Button size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
          Excluir
        </Button>
      </div>
    </div>
  );
}
