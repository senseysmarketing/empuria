import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Settings2, Eye } from "lucide-react";
import { detectProfile, PROFILE_LABELS } from "@/lib/admin/permission-profiles";

export type MemberCardData = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: "admin" | "staff";
  allowed_modules: string[];
};

export function MemberCard({
  member,
  onEdit,
  canEdit,
}: {
  member: MemberCardData;
  onEdit: () => void;
  canEdit: boolean;
}) {
  const isAdmin = member.role === "admin";
  const profile = isAdmin ? null : detectProfile(member.allowed_modules);
  const initials = (member.full_name ?? "?")
    .split(" ")
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="rounded-xl border border-admin-border bg-admin-surface p-5 flex flex-col gap-4 hover:border-admin-accent/40 transition-colors">
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12 border border-admin-border">
          {member.avatar_url && <AvatarImage src={member.avatar_url} />}
          <AvatarFallback className="bg-admin-bg text-admin-ink font-display">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="font-display text-base text-admin-ink truncate">
            {member.full_name ?? "Sem nome"}
          </div>
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {isAdmin ? (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 border-admin-accent/40 text-admin-accent"
              >
                <ShieldCheck className="h-3 w-3" /> Admin
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px]">
                Staff
              </Badge>
            )}
            {profile && (
              <span className="text-xs text-admin-ink-muted">
                Perfil: <span className="text-admin-ink">{PROFILE_LABELS[profile]}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-admin-ink-muted">
        {isAdmin
          ? "Acesso total ao sistema, sem restrições."
          : `${member.allowed_modules.length} módulo${
              member.allowed_modules.length === 1 ? "" : "s"
            } liberado${member.allowed_modules.length === 1 ? "" : "s"}.`}
      </div>

      <div className="mt-auto pt-2 flex justify-end">
        <Button
          variant={isAdmin ? "outline" : "default"}
          size="sm"
          onClick={onEdit}
          disabled={!canEdit && !isAdmin}
          className={isAdmin ? "" : "bg-admin-accent text-white hover:bg-admin-accent/90"}
        >
          {isAdmin ? (
            <>
              <Eye className="h-4 w-4 mr-1.5" /> Ver detalhes
            </>
          ) : (
            <>
              <Settings2 className="h-4 w-4 mr-1.5" /> Editar permissões
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
