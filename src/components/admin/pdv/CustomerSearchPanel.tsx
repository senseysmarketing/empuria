import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Search, UserPlus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { searchCustomers } from "@/lib/admin/pdv-sales.functions";
import { QuickCustomerDialog } from "./QuickCustomerDialog";

export type PdvCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  is_club_member: boolean;
  is_blocked: boolean;
};

export function CustomerSearchPanel({ onSelect }: { onSelect: (c: PdvCustomer) => void }) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [openCreate, setOpenCreate] = useState(false);
  const search = useServerFn(searchCustomers);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["pdv-search", debounced],
    queryFn: () => search({ data: { query: debounced } }),
    enabled: debounced.length >= 2,
  });

  return (
    <div className="max-w-2xl mx-auto w-full space-y-6">
      <div className="text-center space-y-2">
        <h2 className="font-display text-3xl text-admin-ink">Nova venda</h2>
        <p className="text-admin-ink-muted text-sm">Comece buscando ou cadastrando o cliente.</p>
      </div>
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-admin-ink-muted" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar cliente por nome ou telefone…"
          className="pl-12 h-14 text-base bg-admin-surface-2 border-admin-border"
        />
      </div>

      <div className="bg-admin-surface border border-admin-border rounded-xl divide-y divide-admin-border min-h-[120px]">
        {debounced.length < 2 ? (
          <div className="p-6 text-center text-sm text-admin-ink-muted">Digite ao menos 2 caracteres…</div>
        ) : isFetching ? (
          <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-admin-accent" /></div>
        ) : results.length === 0 ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-sm text-admin-ink-muted">Nenhum cliente encontrado.</p>
            <Button onClick={() => setOpenCreate(true)} className="bg-admin-accent text-white">
              <UserPlus className="h-4 w-4" /> Cadastrar novo cliente
            </Button>
          </div>
        ) : (
          results.map((c) => (
            <button
              key={c.id}
              onClick={() => !c.is_blocked && onSelect(c)}
              disabled={c.is_blocked}
              className="w-full flex items-center gap-3 p-4 hover:bg-admin-surface-2 transition-colors text-left disabled:opacity-50"
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={c.avatar_url ?? undefined} />
                <AvatarFallback className="bg-admin-surface-2 text-xs">{c.full_name?.slice(0, 2).toUpperCase() ?? "—"}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-admin-ink truncate">{c.full_name ?? "Sem nome"}</div>
                <div className="text-xs text-admin-ink-muted truncate">{c.phone ?? "—"}</div>
              </div>
              {c.is_club_member && (
                <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-yellow-brand text-brown-deep font-display">Clube</span>
              )}
              {c.is_blocked && (
                <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-display">Bloqueado</span>
              )}
            </button>
          ))
        )}
      </div>

      <div className="text-center">
        <Button variant="outline" onClick={() => setOpenCreate(true)} className="border-admin-border">
          <UserPlus className="h-4 w-4" /> Cadastrar novo cliente
        </Button>
      </div>

      <QuickCustomerDialog open={openCreate} onOpenChange={setOpenCreate} onCreated={onSelect} />
    </div>
  );
}
