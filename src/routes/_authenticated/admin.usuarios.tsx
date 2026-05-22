import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { Search, MoreVertical, Eye, KeyRound, Mail, Ban, ShieldCheck, Pencil, Copy, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  listUsers,
  setUserBlocked,
  forcePasswordReset,
  changeUserEmail,
  impersonateUser,
  type UserRow,
} from "@/lib/admin/usuarios.functions";
import { UsuarioEditSheet } from "@/components/admin/UsuarioEditSheet";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: UsuariosPage,
});

function passportCode(id: string, createdAt: string) {
  const year = new Date(createdAt).getFullYear();
  return `EMP-${year}-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

function relativeTime(iso: string | null) {
  if (!iso) return "Nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

function UsuariosPage() {
  const list = useServerFn(listUsers);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"todos" | "ativos" | "bloqueados">("todos");
  const [clube, setClube] = useState<"todos" | "sim" | "nao">("todos");
  const [period, setPeriod] = useState<"todos" | "7d" | "mes">("todos");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(search, 300);

  const query = useQuery({
    queryKey: ["admin-usuarios", debounced, status, clube, period, page],
    queryFn: () => list({ data: { search: debounced, status, clube, period, page, pageSize: 25 } }),
  });

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-admin-ink flex items-center gap-2">
            <Users className="h-7 w-7 text-admin-accent" /> Passaportes Empuria
          </h1>
          <p className="text-sm text-admin-ink-muted">Gestão de clientes e impersonação segura.</p>
        </div>
      </header>

      {/* Bento controle */}
      <div className="bg-offwhite rounded-2xl p-5 shadow-sm border border-admin-border/30 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-brown/50" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Buscar por nome, e-mail ou passaporte EMP-…"
              className="pl-9 bg-white border-brown/20 text-brown-deep h-11"
            />
          </div>
          <Select value={status} onValueChange={(v: typeof status) => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-[150px] bg-white border-brown/20 text-brown-deep h-11"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="ativos">Ativos</SelectItem><SelectItem value="bloqueados">Bloqueados</SelectItem></SelectContent>
          </Select>
          <Select value={clube} onValueChange={(v: typeof clube) => { setClube(v); setPage(1); }}>
            <SelectTrigger className="w-[150px] bg-white border-brown/20 text-brown-deep h-11"><SelectValue placeholder="Clube" /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="sim">Membros</SelectItem><SelectItem value="nao">Não membros</SelectItem></SelectContent>
          </Select>
          <Select value={period} onValueChange={(v: typeof period) => { setPeriod(v); setPage(1); }}>
            <SelectTrigger className="w-[150px] bg-white border-brown/20 text-brown-deep h-11"><SelectValue placeholder="Cadastro" /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Sempre</SelectItem><SelectItem value="7d">7 dias</SelectItem><SelectItem value="mes">Este mês</SelectItem></SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-3 pt-2">
          <MiniTile label="Ativos" value={query.data?.totalActive ?? 0} />
          <MiniTile label="Membros do Clube" value={query.data?.totalClub ?? 0} accent />
          <MiniTile label="Novos no mês" value={query.data?.newThisMonth ?? 0} />
        </div>
      </div>

      {/* Lista */}
      <div className="space-y-2">
        {query.isLoading && <p className="text-sm text-admin-ink-muted">Carregando…</p>}
        {!query.isLoading && items.length === 0 && (
          <p className="text-sm text-admin-ink-muted text-center py-12">Nenhum usuário encontrado.</p>
        )}
        {items.map((u) => (
          <UserRowCard key={u.id} user={u} />
        ))}
      </div>

      {(query.data?.total ?? 0) > 25 && (
        <div className="flex items-center justify-between text-sm text-admin-ink-muted">
          <span>{query.data?.total} resultados</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={items.length < 25} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MiniTile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={`rounded-xl px-4 py-3 ${accent ? "bg-yellow-brand/15 border border-yellow-brand/40" : "bg-white border border-brown/10"}`}>
      <div className="text-[10px] uppercase tracking-widest text-brown/60 font-display">{label}</div>
      <div className="font-display text-2xl font-bold text-brown-deep tabular-nums">{value}</div>
    </div>
  );
}

function UserRowCard({ user }: { user: UserRow }) {
  const qc = useQueryClient();
  const block = useServerFn(setUserBlocked);
  const reset = useServerFn(forcePasswordReset);
  const changeEmail = useServerFn(changeUserEmail);
  const impersonate = useServerFn(impersonateUser);

  const [editOpen, setEditOpen] = useState(false);
  const [blockConfirm, setBlockConfirm] = useState(false);
  const [emailDialog, setEmailDialog] = useState(false);
  const [newEmail, setNewEmail] = useState(user.email ?? "");
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [reason, setReason] = useState("");

  const code = useMemo(() => passportCode(user.id, user.created_at), [user.id, user.created_at]);
  const initial = (user.full_name ?? user.email ?? "?").charAt(0).toUpperCase();

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-usuarios"] });

  const blockMut = useMutation({
    mutationFn: () => block({ data: { id: user.id, blocked: !user.is_blocked } }),
    onSuccess: () => { toast.success(user.is_blocked ? "Conta desbloqueada" : "Conta bloqueada"); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { id: user.id } }),
    onSuccess: ({ url }) => {
      navigator.clipboard.writeText(url);
      toast.success("Link de recuperação copiado para a área de transferência");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const emailMut = useMutation({
    mutationFn: () => changeEmail({ data: { id: user.id, new_email: newEmail } }),
    onSuccess: () => { toast.success("E-mail alterado"); setEmailDialog(false); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const impersonateMut = useMutation({
    mutationFn: () => impersonate({ data: { id: user.id, reason } }),
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
      toast.success("Sessão aberta em nova aba. Sua conta admin segue ativa aqui.");
      setImpersonateOpen(false);
      setReason("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <div className="bg-admin-surface border border-admin-border rounded-xl p-4 flex items-center gap-4 hover:border-admin-accent/40 transition-colors">
        {user.avatar_url ? (
          <img src={user.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-full bg-gradient-to-br from-brown to-red-brand text-offwhite flex items-center justify-center font-display font-bold">{initial}</div>
        )}

        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-admin-ink truncate" style={{ fontFamily: "Philosopher, serif" }}>{user.full_name ?? "Sem nome"}</div>
          <div className="text-xs text-admin-ink-muted truncate">{user.email ?? "—"}</div>
        </div>

        <button
          onClick={() => { navigator.clipboard.writeText(code); toast.success("Passaporte copiado"); }}
          className="hidden md:flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-md bg-admin-bg border border-admin-border text-admin-ink-muted hover:text-admin-ink"
          title="Copiar passaporte"
        >
          <Copy className="h-3 w-3" /> {code}
        </button>

        <span className={`hidden md:inline-flex text-[10px] font-display uppercase tracking-wider px-2 py-0.5 rounded-full ${user.is_blocked ? "bg-red-brand/15 text-red-brand" : "bg-emerald-500/15 text-emerald-500"}`}>
          {user.is_blocked ? "Bloqueado" : "Ativo"}
        </span>

        <span className={`hidden lg:inline-flex text-[10px] font-display uppercase tracking-wider px-2 py-0.5 rounded-full ${user.is_club_member ? "bg-yellow-brand/20 text-yellow-brand" : "bg-admin-border text-admin-ink-muted"}`}>
          {user.is_club_member ? "VIP" : "Standard"}
        </span>

        <div className="hidden lg:block text-xs text-admin-ink-muted w-24 text-right">{relativeTime(user.last_sign_in_at)}</div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-admin-ink-muted hover:text-admin-ink"><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="bg-admin-surface border-admin-border">
            <DropdownMenuItem onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4 mr-2" /> Editar perfil</DropdownMenuItem>
            <DropdownMenuItem onClick={() => resetMut.mutate()}><KeyRound className="h-4 w-4 mr-2" /> Trocar senha</DropdownMenuItem>
            <DropdownMenuItem onClick={() => { setNewEmail(user.email ?? ""); setEmailDialog(true); }}><Mail className="h-4 w-4 mr-2" /> Alterar e-mail</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setBlockConfirm(true)} className={user.is_blocked ? "text-emerald-500" : "text-red-brand"}>
              {user.is_blocked ? <><ShieldCheck className="h-4 w-4 mr-2" /> Desbloquear</> : <><Ban className="h-4 w-4 mr-2" /> Bloquear</>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setImpersonateOpen(true)} className="text-admin-accent font-display">
              <Eye className="h-4 w-4 mr-2" /> Acessar como usuário
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <UsuarioEditSheet user={user} open={editOpen} onClose={() => setEditOpen(false)} onSaved={refresh} />

      <AlertDialog open={blockConfirm} onOpenChange={setBlockConfirm}>
        <AlertDialogContent className="bg-admin-surface border-admin-border text-admin-ink">
          <AlertDialogHeader>
            <AlertDialogTitle>{user.is_blocked ? "Desbloquear conta?" : "Bloquear conta?"}</AlertDialogTitle>
            <AlertDialogDescription className="text-admin-ink-muted">
              {user.is_blocked ? "O usuário poderá voltar a fazer login normalmente." : "O usuário perderá acesso imediatamente."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => blockMut.mutate()} className={user.is_blocked ? "bg-emerald-500" : "bg-red-brand"}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={emailDialog} onOpenChange={setEmailDialog}>
        <DialogContent className="bg-admin-surface border-admin-border text-admin-ink">
          <DialogHeader><DialogTitle>Alterar e-mail</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Novo e-mail</Label>
            <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="bg-admin-bg border-admin-border" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialog(false)}>Cancelar</Button>
            <Button onClick={() => emailMut.mutate()} disabled={emailMut.isPending} className="bg-admin-accent text-white">Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <AlertDialogContent className="bg-admin-surface border-admin-border text-admin-ink max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-admin-accent" /> Acessar como {user.full_name ?? "usuário"}</AlertDialogTitle>
            <AlertDialogDescription className="text-admin-ink-muted">
              Uma nova aba será aberta com a sessão deste cliente. Sua conta admin permanece ativa nesta aba.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-yellow-brand/10 border border-yellow-brand/40 rounded-lg p-3 text-xs text-admin-ink">
            ⚠️ Esta ação fica registrada em <strong>impersonation_logs</strong> com seu ID e o motivo informado.
          </div>
          <div className="space-y-2">
            <Label>Motivo (mín. 10 caracteres)</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: suporte ao WhatsApp — cliente não consegue ver os ingressos." className="bg-admin-bg border-admin-border min-h-24" />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); impersonateMut.mutate(); }}
              disabled={reason.trim().length < 10 || impersonateMut.isPending}
              className="bg-admin-accent text-white"
            >
              Abrir sessão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
