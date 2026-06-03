import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { UserPlus, Search } from "lucide-react";
import { listStaffWithPermissions } from "@/lib/admin/permissions.functions";
import { useCurrentUser } from "@/hooks/use-current-user";
import { NewStaffDialog } from "./NewStaffDialog";
import { MemberCard, type MemberCardData } from "./MemberCard";
import { EditMemberPermissionsDialog } from "./EditMemberPermissionsDialog";
import { cn } from "@/lib/utils";

type Filter = "todos" | "admin" | "staff";

export function EquipePermissoesTab() {
  const fetchList = useServerFn(listStaffWithPermissions);
  const { isAdmin } = useCurrentUser();

  const [openNew, setOpenNew] = useState(false);
  const [editing, setEditing] = useState<MemberCardData | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["staff-permissions"],
    queryFn: () => fetchList(),
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "admin" && u.role !== "admin") return false;
      if (filter === "staff" && u.role !== "staff") return false;
      if (!q) return true;
      return (u.full_name ?? "").toLowerCase().includes(q);
    });
  }, [users, query, filter]);

  return (
    <>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="font-display text-xl text-admin-ink">Equipe & Permissões</h3>
            <p className="text-xs text-admin-ink-muted mt-1">
              Admins têm acesso total automático. Edite cada staff para escolher um perfil
              de acesso ou ajustar os grupos manualmente.
            </p>
          </div>
          {isAdmin && (
            <Button
              onClick={() => setOpenNew(true)}
              className="bg-admin-accent text-white gap-2 shrink-0"
            >
              <UserPlus className="h-4 w-4" /> Novo membro
            </Button>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-admin-ink-muted" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome…"
              className="pl-9 bg-admin-surface border-admin-border"
            />
          </div>
          <div className="flex gap-1 rounded-lg border border-admin-border bg-admin-surface p-1">
            {(["todos", "admin", "staff"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "px-3 py-1.5 text-xs uppercase tracking-wider rounded-md transition-colors",
                  filter === f
                    ? "bg-admin-accent text-white"
                    : "text-admin-ink-muted hover:text-admin-ink",
                )}
              >
                {f === "todos" ? "Todos" : f === "admin" ? "Admins" : "Staff"}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-admin-ink-muted text-sm">
            Carregando equipe…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-admin-ink-muted text-sm border border-dashed border-admin-border rounded-xl">
            Nenhum membro encontrado.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((u) => (
              <MemberCard
                key={u.id}
                member={u as MemberCardData}
                canEdit={isAdmin}
                onEdit={() => setEditing(u as MemberCardData)}
              />
            ))}
          </div>
        )}
      </div>

      <NewStaffDialog open={openNew} onOpenChange={setOpenNew} />
      <EditMemberPermissionsDialog
        member={editing}
        open={!!editing}
        onOpenChange={(v) => !v && setEditing(null)}
      />
    </>
  );
}
