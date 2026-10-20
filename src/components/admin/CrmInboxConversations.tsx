import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  AlertCircle,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  Mic,
  Paperclip,
  Smile,
  Square,
  Link2,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createCrmLead, searchCrmLeads } from "@/lib/admin/crm.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  allowedMediaMime,
  INBOX_MEDIA_BUCKET,
  MAX_INBOX_MEDIA_BYTES,
  mediaKind,
  normalizedReceipt,
  type InboxMediaKind,
} from "@/lib/uazapi/uazapi.media";
import {
  prepareCrmInboxMedia,
  discardCrmInboxMedia,
  recoverCrmInboxMedia,
  sendCrmInboxMedia,
  getCrmInboxConnection,
  getCrmConversation,
  linkCrmConversationLead,
  listCrmConversationMessages,
  listCrmConversations,
  markCrmConversationRead,
  reconcileLegacyCrmInbox,
  sendCrmInboxText,
  syncCrmInboxChats,
  syncCrmInboxHistory,
} from "@/lib/admin/crm-inbox.functions";

type Conversation = {
  id: string;
  lead_id: string | null;
  provider_chat_id: string;
  phone: string;
  contact_name: string | null;
  last_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
};
type Message = {
  id: string;
  direction: "inbound" | "outbound";
  body: string | null;
  message_type: string;
  status: string | null;
  created_at: string;
  media_kind: InboxMediaKind | null;
  media_mime: string | null;
  media_name: string | null;
  media_size: number | null;
  media_url: string | null;
};
type LeadResult = { id: string; full_name: string; phone: string };
type Attachment = { file: File; kind: InboxMediaKind; requestId: string; path?: string };

function messageTime(date: string) {
  return new Date(date).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function Receipt({ status }: { status: string | null }) {
  const state = normalizedReceipt(status);
  const label = {
    pending: "Pendente",
    sent: "Enviado",
    delivered: "Entregue",
    read: "Lido",
    failed: "Falha ou envio incerto",
  }[state];
  const Icon =
    state === "read" || state === "delivered"
      ? CheckCheck
      : state === "sent"
        ? Check
        : state === "failed"
          ? AlertCircle
          : Clock3;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={state === "read" ? "text-sky-300" : ""}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

function MessageMedia({
  message,
  onRecover,
  recovering,
}: {
  message: Message;
  onRecover: () => void;
  recovering: boolean;
}) {
  const kind = message.media_kind ?? mediaKind(message.message_type);
  if (!kind) return null;
  if (!message.media_url)
    return (
      <button
        type="button"
        onClick={onRecover}
        disabled={recovering}
        className="mb-1 flex items-center gap-1 text-left text-xs underline disabled:opacity-60"
      >
        {recovering ? "Recuperando mídia..." : "Mídia indisponível · tentar recuperar"}
      </button>
    );
  if (kind === "image")
    return (
      <a href={message.media_url} target="_blank" rel="noreferrer" aria-label="Ampliar imagem">
        <img
          src={message.media_url}
          alt={message.media_name || "Imagem recebida"}
          loading="lazy"
          className="mb-1 max-h-64 max-w-full rounded-lg object-contain"
        />
      </a>
    );
  if (kind === "video")
    return (
      <video
        src={message.media_url}
        controls
        preload="metadata"
        className="mb-1 max-h-64 max-w-full rounded-lg"
      />
    );
  if (kind === "audio")
    return (
      <audio src={message.media_url} controls preload="metadata" className="mb-1 max-w-full" />
    );
  return (
    <a
      href={message.media_url}
      download={message.media_name || true}
      target="_blank"
      rel="noreferrer"
      className="mb-1 flex items-center gap-2 underline"
    >
      <FileText className="h-4 w-4" />
      {message.media_name || "Baixar documento"}
    </a>
  );
}

export function CrmInboxConversations({
  onOpenLead,
  selectedConversationId,
}: {
  onOpenLead: (leadId: string) => void;
  selectedConversationId?: string | null;
}) {
  const qc = useQueryClient();
  const fetchConversations = useServerFn(listCrmConversations);
  const fetchConversation = useServerFn(getCrmConversation);
  const fetchMessages = useServerFn(listCrmConversationMessages);
  const connectionFn = useServerFn(getCrmInboxConnection);
  const markReadFn = useServerFn(markCrmConversationRead);
  const sendFn = useServerFn(sendCrmInboxText);
  const prepareMediaFn = useServerFn(prepareCrmInboxMedia);
  const discardMediaFn = useServerFn(discardCrmInboxMedia);
  const sendMediaFn = useServerFn(sendCrmInboxMedia);
  const recoverMediaFn = useServerFn(recoverCrmInboxMedia);
  const syncChatsFn = useServerFn(syncCrmInboxChats);
  const syncHistoryFn = useServerFn(syncCrmInboxHistory);
  const createLeadFn = useServerFn(createCrmLead);
  const searchLeadsFn = useServerFn(searchCrmLeads);
  const linkLeadFn = useServerFn(linkCrmConversationLead);
  const reconcileLegacyFn = useServerFn(reconcileLegacyCrmInbox);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [uncertain, setUncertain] = useState<Record<string, boolean>>({});
  const [attachments, setAttachments] = useState<Record<string, Attachment>>({});
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [leadSearch, setLeadSearch] = useState("");
  const [newLeadName, setNewLeadName] = useState("");
  const [syncOffset, setSyncOffset] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const sendingRef = useRef(false);
  const directReadRef = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const cancelRecordingRef = useRef(false);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const scrollAnchorRef = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (selectedConversationId) {
      setSelectedId(selectedConversationId);
      setHistoryOffset(0);
    }
  }, [selectedConversationId]);

  const conversationsQ = useInfiniteQuery({
    queryKey: ["crm-inbox", "conversations", debouncedSearch, unreadOnly],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchConversations({ data: { offset: pageParam, search: debouncedSearch, unreadOnly } }),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    refetchInterval: 20000,
  });
  const conversations = useMemo(
    () => (conversationsQ.data?.pages.flatMap((page) => page.items) ?? []) as Conversation[],
    [conversationsQ.data],
  );
  const selectedInList = conversations.find((conversation) => conversation.id === selectedId);
  const selectedQ = useQuery({
    queryKey: ["crm-inbox", "conversation", selectedId],
    queryFn: () => fetchConversation({ data: { conversationId: selectedId! } }),
    enabled: Boolean(selectedId) && !selectedInList,
  });
  const selected = selectedInList ?? (selectedQ.data as Conversation | null) ?? null;
  const draft = selectedId ? (drafts[selectedId] ?? "") : "";
  const attachment = selectedId ? attachments[selectedId] : undefined;
  useEffect(() => {
    if (!attachment) {
      setAttachmentPreview(null);
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    setAttachmentPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);
  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRecording]);
  const messagesQ = useInfiniteQuery({
    queryKey: ["crm-inbox", "messages", selectedId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchMessages({ data: { conversationId: selectedId!, offset: pageParam } }),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    enabled: Boolean(selectedId),
    refetchInterval: 12000,
  });
  const messages = useMemo(
    () =>
      ((messagesQ.data?.pages.flatMap((page) => page.items) ?? []) as Message[]).sort(
        (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      ),
    [messagesQ.data],
  );
  useLayoutEffect(() => {
    const element = messageScrollRef.current;
    const anchor = scrollAnchorRef.current;
    if (element && anchor) {
      element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
      scrollAnchorRef.current = null;
    }
  }, [messages.length]);
  const connectionQ = useQuery({
    queryKey: ["crm-inbox", "connection"],
    queryFn: () => connectionFn(),
    refetchInterval: 30000,
  });
  const legacyQ = useQuery({
    queryKey: ["crm-inbox-legacy-reconcile"],
    queryFn: () => reconcileLegacyFn(),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    if (legacyQ.data?.imported) qc.invalidateQueries({ queryKey: ["crm-inbox", "conversations"] });
  }, [legacyQ.data?.imported, qc]);
  const leadResultsQ = useQuery({
    queryKey: ["crm-inbox", "lead-search", leadSearch],
    queryFn: () => searchLeadsFn({ data: { search: leadSearch } }) as Promise<LeadResult[]>,
    enabled: linkOpen && leadSearch.trim().length >= 2,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["crm-inbox"] });
    qc.invalidateQueries({ queryKey: ["crm-workspace"] });
  };
  const readMutation = useMutation({
    mutationFn: (id: string) => markReadFn({ data: { conversationId: id } }),
    onSuccess: refresh,
    onError: () => toast.error("Nao foi possivel marcar a conversa como lida."),
  });
  useEffect(() => {
    if (
      selectedConversationId &&
      selected?.id === selectedConversationId &&
      selected.unread_count > 0 &&
      !directReadRef.current.has(selectedConversationId)
    ) {
      directReadRef.current.add(selectedConversationId);
      readMutation.mutate(selectedConversationId);
    }
  }, [selectedConversationId, selected?.id, selected?.unread_count, readMutation]);
  const sendMutation = useMutation({
    mutationFn: ({
      conversationId,
      text,
      requestId,
    }: {
      conversationId: string;
      text: string;
      requestId: string;
    }) => sendFn({ data: { conversationId, text, requestId } }),
    onSuccess: (result, variables) => {
      refresh();
      if (result.ok) {
        setDrafts((old) => ({
          ...old,
          [variables.conversationId]:
            old[variables.conversationId] === variables.text ? "" : old[variables.conversationId],
        }));
        setUncertain((old) => ({ ...old, [variables.conversationId]: false }));
      } else {
        setUncertain((old) => ({ ...old, [variables.conversationId]: true }));
        toast.error("Resultado do envio incerto. Confira a conversa antes de tentar novamente.");
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Nao foi possivel enviar."),
    onSettled: () => {
      sendingRef.current = false;
    },
  });
  const submitMessage = () => {
    if (
      sendingRef.current ||
      !selectedId ||
      uncertain[selectedId] ||
      !connectionQ.data?.connected ||
      !draft.trim()
    )
      return;
    sendingRef.current = true;
    sendMutation.mutate({
      conversationId: selectedId,
      text: draft.trim(),
      requestId: crypto.randomUUID(),
    });
  };
  const mediaMutation = useMutation({
    mutationFn: async ({
      conversationId,
      item,
      caption,
    }: {
      conversationId: string;
      item: Attachment;
      caption: string;
    }) => {
      const info = {
        conversationId,
        requestId: item.requestId,
        kind: item.kind,
        mime: item.file.type,
        name: item.file.name,
        size: item.file.size,
      };
      let path = item.path;
      if (!path) {
        const signed = await prepareMediaFn({ data: info });
        const { error } = await supabase.storage
          .from(INBOX_MEDIA_BUCKET)
          .uploadToSignedUrl(signed.path, signed.token, item.file, { contentType: item.file.type });
        if (error) throw new Error("Falha no upload privado do anexo.");
        path = signed.path;
        setAttachments((old) => ({
          ...old,
          [conversationId]:
            old[conversationId]?.requestId === item.requestId
              ? { ...old[conversationId], path }
              : old[conversationId],
        }));
      }
      return sendMediaFn({ data: { ...info, path, caption } });
    },
    onSuccess: (result, variables) => {
      refresh();
      if (result.ok) {
        setAttachments((old) => {
          const next = { ...old };
          if (next[variables.conversationId]?.requestId === variables.item.requestId)
            delete next[variables.conversationId];
          return next;
        });
        setDrafts((old) => ({
          ...old,
          [variables.conversationId]:
            old[variables.conversationId] === variables.caption
              ? ""
              : old[variables.conversationId],
        }));
        setUncertain((old) => ({ ...old, [variables.conversationId]: false }));
      } else {
        setUncertain((old) => ({ ...old, [variables.conversationId]: true }));
        toast.error("Envio da mídia incerto. Confira a conversa antes de tentar novamente.");
      }
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao enviar anexo."),
    onSettled: () => {
      sendingRef.current = false;
    },
  });
  const recoverMutation = useMutation({
    mutationFn: (messageId: string) =>
      recoverMediaFn({ data: { conversationId: selectedId!, messageId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-inbox", "messages", selectedId] }),
    onError: () =>
      toast.error("Mídia indisponível na origem. O histórico da mensagem foi preservado."),
  });
  const chooseAttachment = (file: File, kind: InboxMediaKind) => {
    if (
      !selectedId ||
      !allowedMediaMime(kind, file.type) ||
      file.size < 1 ||
      file.size > MAX_INBOX_MEDIA_BYTES ||
      (kind === "video" && !file.name.toLowerCase().endsWith(".mp4"))
    ) {
      toast.error("Arquivo inválido. Use imagem, vídeo MP4 ou documento de até 16 MB.");
      return;
    }
    setAttachments((old) => ({
      ...old,
      [selectedId]: { file, kind, requestId: crypto.randomUUID() },
    }));
  };
  const sendAttachment = () => {
    if (
      !selectedId ||
      !attachment ||
      sendingRef.current ||
      uncertain[selectedId] ||
      !connectionQ.data?.connected
    )
      return;
    sendingRef.current = true;
    mediaMutation.mutate({ conversationId: selectedId, item: attachment, caption: draft.trim() });
  };
  const startRecording = async () => {
    if (
      !selectedId ||
      !navigator.mediaDevices?.getUserMedia ||
      !window.MediaRecorder?.isTypeSupported("audio/ogg;codecs=opus")
    ) {
      toast.error(
        "Este navegador não grava OGG/Opus para mensagens de voz. Use um navegador compatível.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      cancelRecordingRef.current = false;
      const recorder = new MediaRecorder(stream, { mimeType: "audio/ogg;codecs=opus" });
      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        setIsRecording(false);
        if (cancelRecordingRef.current) return;
        const blob = new Blob(chunks, { type: "audio/ogg" });
        if (!blob.size || blob.size > MAX_INBOX_MEDIA_BYTES) {
          toast.error("Gravação vazia ou muito longa.");
          return;
        }
        const file = new File([blob], `voz-${Date.now()}.ogg`, { type: "audio/ogg" });
        chooseAttachment(file, "audio");
      };
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      recorder.start(250);
      setIsRecording(true);
    } catch {
      toast.error("Não foi possível acessar o microfone. Verifique a permissão.");
    }
  };
  const stopRecording = (cancel = false) => {
    cancelRecordingRef.current = cancel;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    setIsRecording(false);
  };
  const syncMutation = useMutation({
    mutationFn: () => syncChatsFn({ data: { offset: syncOffset } }),
    onSuccess: (result) => {
      setSyncOffset(result.nextOffset ?? 0);
      refresh();
      toast.success(`${result.imported} mensagem(ns) conciliada(s).`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha na sincronizacao."),
  });
  const historyMutation = useMutation({
    mutationFn: () =>
      syncHistoryFn({ data: { conversationId: selectedId!, offset: historyOffset } }),
    onSuccess: (result) => {
      setHistoryOffset(result.nextOffset ?? historyOffset);
      refresh();
      toast.success(`${result.imported} mensagem(ns) anterior(es) conciliada(s).`);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao carregar historico anterior."),
  });
  const linkMutation = useMutation({
    mutationFn: (leadId: string) => linkLeadFn({ data: { conversationId: selectedId!, leadId } }),
    onSuccess: () => {
      setLinkOpen(false);
      refresh();
      toast.success("Conversa vinculada ao lead.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Falha ao vincular lead."),
  });
  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await createLeadFn({
        data: { full_name: newLeadName, phone: selected!.phone, source: "whatsapp" },
      });
      await linkLeadFn({ data: { conversationId: selectedId!, leadId: created.id } });
    },
    onSuccess: () => {
      setLinkOpen(false);
      refresh();
      toast.success("Lead criado e vinculado.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Nao foi possivel criar o lead."),
  });

  return (
    <div className="grid h-[calc(100dvh-12rem)] min-h-[300px] max-h-[820px] overflow-hidden rounded-xl border border-admin-border bg-admin-surface md:grid-cols-[minmax(280px,340px)_1fr]">
      <div
        className={`${selectedId ? "hidden md:flex" : "flex"} min-h-0 min-w-0 flex-col border-r border-admin-border`}
      >
        <div className="space-y-3 border-b border-admin-border p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">Conversas</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => syncMutation.mutate()}
              disabled={!connectionQ.data?.connected || syncMutation.isPending}
              title="Sincronizar proxima pagina de ate 10 chats"
            >
              {syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-1">Sincronizar</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-admin-ink-muted" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar nome ou telefone"
              className="pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={unreadOnly ? "outline" : "default"}
              onClick={() => setUnreadOnly(false)}
            >
              Todas
            </Button>
            <Button
              size="sm"
              variant={unreadOnly ? "default" : "outline"}
              onClick={() => setUnreadOnly(true)}
            >
              Nao lidas
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {conversationsQ.isLoading && (
            <p className="p-4 text-sm text-admin-ink-muted">Carregando conversas...</p>
          )}
          {conversationsQ.isError && (
            <p className="p-4 text-sm text-red-600">Erro ao carregar conversas.</p>
          )}
          {!conversationsQ.isLoading && !conversations.length && (
            <p className="p-4 text-sm text-admin-ink-muted">Nenhuma conversa encontrada.</p>
          )}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => {
                setSelectedId(conversation.id);
                setHistoryOffset(0);
                if (conversation.unread_count) readMutation.mutate(conversation.id);
              }}
              className={`w-full border-b border-admin-border p-4 text-left hover:bg-admin-bg ${selectedId === conversation.id ? "bg-admin-bg" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">
                  {conversation.contact_name || conversation.phone}
                </span>
                <span className="shrink-0 text-xs text-admin-ink-muted">
                  {conversation.last_message_at
                    ? new Date(conversation.last_message_at).toLocaleDateString("pt-BR")
                    : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm text-admin-ink-muted">
                  {conversation.last_preview || "Sem mensagens"}
                </span>
                {conversation.unread_count > 0 && <Badge>{conversation.unread_count}</Badge>}
              </div>
            </button>
          ))}
          {conversationsQ.hasNextPage && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => conversationsQ.fetchNextPage()}
              disabled={conversationsQ.isFetchingNextPage}
            >
              Carregar mais conversas
            </Button>
          )}
        </div>
      </div>
      <div className={`${selectedId ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-col`}>
        {!selected ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-admin-ink-muted">
            <MessageCircle className="h-10 w-10" />
            <p>Selecione uma conversa para ver o historico.</p>
          </div>
        ) : (
          <>
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-admin-border p-4">
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  size="icon"
                  variant="ghost"
                  className="md:hidden"
                  onClick={() => setSelectedId(null)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                  <h3 className="truncate font-medium">
                    {selected.contact_name || selected.phone}
                  </h3>
                  <p className="text-xs text-admin-ink-muted">{selected.phone}</p>
                </div>
              </div>
              {selected.lead_id ? (
                <Button size="sm" variant="outline" onClick={() => onOpenLead(selected.lead_id!)}>
                  Ver lead
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setNewLeadName(selected.contact_name || "");
                    setLinkOpen(true);
                  }}
                >
                  <Link2 className="mr-1 h-4 w-4" /> Vincular lead
                </Button>
              )}
            </header>
            <div
              ref={messageScrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-admin-bg p-4"
            >
              {messagesQ.hasNextPage && (
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    const element = messageScrollRef.current;
                    if (element)
                      scrollAnchorRef.current = {
                        height: element.scrollHeight,
                        top: element.scrollTop,
                      };
                    void messagesQ.fetchNextPage();
                  }}
                  disabled={messagesQ.isFetchingNextPage}
                >
                  Carregar mensagens anteriores
                </Button>
              )}
              {connectionQ.data?.connected && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => historyMutation.mutate()}
                  disabled={historyMutation.isPending}
                >
                  Conciliar historico anterior da Uazapi
                </Button>
              )}
              {messagesQ.isLoading && (
                <p className="text-sm text-admin-ink-muted">Carregando mensagens...</p>
              )}
              {messagesQ.isError && (
                <p className="text-sm text-red-600">Erro ao carregar mensagens.</p>
              )}
              {messages.map((message, index) => {
                const day = new Date(message.created_at).toLocaleDateString("pt-BR");
                const previousDay = index
                  ? new Date(messages[index - 1].created_at).toLocaleDateString("pt-BR")
                  : null;
                const hasMedia = Boolean(message.media_kind ?? mediaKind(message.message_type));
                return (
                  <div key={message.id}>
                    {day !== previousDay && (
                      <p className="my-3 text-center text-xs text-admin-ink-muted">{day}</p>
                    )}
                    <div
                      className={`flex ${message.direction === "outbound" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-xl px-3 py-2 text-sm shadow-sm ${message.direction === "outbound" ? "bg-admin-accent text-white" : "bg-admin-surface text-admin-ink"}`}
                      >
                        <MessageMedia
                          message={message}
                          recovering={recoverMutation.isPending}
                          onRecover={() => recoverMutation.mutate(message.id)}
                        />
                        {message.body && (
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        )}
                        {!message.body && !hasMedia && (
                          <p>Tipo de mensagem não suportado: {message.message_type}</p>
                        )}
                        <div className="mt-1 flex items-center justify-end gap-2 text-[11px] opacity-75">
                          <span>{messageTime(message.created_at)}</span>
                          {message.direction === "outbound" && <Receipt status={message.status} />}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="shrink-0 space-y-2 border-t border-admin-border bg-admin-surface p-3">
              {selectedId && uncertain[selectedId] && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-amber-700">
                  <span>
                    Envio incerto. Rascunho preservado; confira a conversa antes de tentar
                    novamente.
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setUncertain((old) => ({ ...old, [selectedId]: false }));
                      setAttachments((old) =>
                        old[selectedId]
                          ? {
                              ...old,
                              [selectedId]: {
                                ...old[selectedId],
                                requestId: crypto.randomUUID(),
                                path: undefined,
                              },
                            }
                          : old,
                      );
                    }}
                  >
                    Ja conferi a conversa
                  </Button>
                </div>
              )}
              {!connectionQ.data?.connected && (
                <p className="text-xs text-amber-700">
                  WhatsApp desconectado. Conecte a Uazapi em Configuracoes para responder.
                </p>
              )}
              {attachment && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-admin-border p-2 text-xs">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{attachment.file.name}</p>
                    {attachmentPreview && attachment.kind === "image" && (
                      <img
                        src={attachmentPreview}
                        alt="Prévia do anexo"
                        className="mt-1 max-h-24 rounded"
                      />
                    )}
                    {attachmentPreview && attachment.kind === "video" && (
                      <video src={attachmentPreview} controls className="mt-1 max-h-24" />
                    )}
                    {attachmentPreview && attachment.kind === "audio" && (
                      <audio src={attachmentPreview} controls className="mt-1 max-w-full" />
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (attachment.path)
                        void discardMediaFn({
                          data: {
                            conversationId: selectedId!,
                            requestId: attachment.requestId,
                            path: attachment.path,
                          },
                        }).catch(() => undefined);
                      setAttachments((old) => {
                        const next = { ...old };
                        delete next[selectedId!];
                        return next;
                      });
                    }}
                    disabled={
                      mediaMutation.isPending || Boolean(selectedId && uncertain[selectedId])
                    }
                  >
                    Cancelar
                  </Button>
                </div>
              )}
              {isRecording && (
                <p className="text-xs text-red-600">
                  Gravando voz ·{" "}
                  {Math.floor(recordingSeconds / 60)
                    .toString()
                    .padStart(2, "0")}
                  :{(recordingSeconds % 60).toString().padStart(2, "0")}
                </p>
              )}
              <div className="flex items-center gap-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp,video/mp4,application/pdf,.docx,.xlsx,text/plain"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file)
                      chooseAttachment(
                        file,
                        file.type.startsWith("image/")
                          ? "image"
                          : file.type === "video/mp4"
                            ? "video"
                            : "document",
                      );
                    event.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Anexar arquivo"
                  title="Anexar arquivo"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!connectionQ.data?.connected || isRecording}
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label="Emoji"
                  title="Emoji"
                  onClick={() => setEmojiOpen((open) => !open)}
                >
                  <Smile className="h-4 w-4" />
                </Button>
                {!isRecording ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Gravar áudio"
                    title="Gravar áudio"
                    onClick={() => void startRecording()}
                    disabled={!connectionQ.data?.connected || Boolean(attachment)}
                  >
                    <Mic className="h-4 w-4" />
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => stopRecording(true)}
                    >
                      Cancelar voz
                    </Button>
                    <Button type="button" size="sm" onClick={() => stopRecording()}>
                      <Square className="mr-1 h-3 w-3" />
                      Parar
                    </Button>
                  </>
                )}
              </div>
              {emojiOpen && (
                <div className="flex flex-wrap gap-1" aria-label="Escolher emoji">
                  {["😊", "👍", "❤️", "🙏", "🎉", "😀", "👋", "✨"].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      className="rounded p-1 hover:bg-admin-bg"
                      onClick={() => {
                        setDrafts((old) => ({
                          ...old,
                          [selectedId!]: (old[selectedId!] ?? "") + emoji,
                        }));
                        setEmojiOpen(false);
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(event) =>
                    setDrafts((old) => ({ ...old, [selectedId!]: event.target.value }))
                  }
                  rows={2}
                  placeholder="Escreva uma resposta manual..."
                  disabled={
                    !connectionQ.data?.connected ||
                    sendMutation.isPending ||
                    mediaMutation.isPending
                  }
                />
                <Button
                  size="icon"
                  onClick={attachment ? sendAttachment : submitMessage}
                  disabled={
                    !connectionQ.data?.connected ||
                    (!attachment && !draft.trim()) ||
                    sendMutation.isPending ||
                    mediaMutation.isPending ||
                    isRecording ||
                    Boolean(selectedId && uncertain[selectedId])
                  }
                  aria-label="Enviar mensagem"
                >
                  {sendMutation.isPending || mediaMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lead desta conversa</DialogTitle>
            <DialogDescription>
              Vincule um lead existente ou crie um novo. O historico permanece nesta conversa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Input
                value={leadSearch}
                onChange={(event) => setLeadSearch(event.target.value)}
                placeholder="Buscar lead por nome, telefone ou e-mail"
              />
              {leadResultsQ.data?.map((lead) => (
                <Button
                  key={lead.id}
                  variant="outline"
                  className="w-full justify-start truncate"
                  onClick={() => linkMutation.mutate(lead.id)}
                  disabled={linkMutation.isPending}
                >
                  {lead.full_name} · {lead.phone}
                </Button>
              ))}
            </div>
            <div className="border-t border-admin-border pt-4">
              <Input
                value={newLeadName}
                onChange={(event) => setNewLeadName(event.target.value)}
                placeholder="Nome do novo lead"
              />
              <Button
                className="mt-2 w-full"
                onClick={() => createMutation.mutate()}
                disabled={newLeadName.trim().length < 2 || createMutation.isPending}
              >
                <Plus className="mr-1 h-4 w-4" /> Criar e vincular
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
