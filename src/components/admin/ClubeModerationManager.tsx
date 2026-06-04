import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Award, Eye, EyeOff, Heart, MessageSquare, Trash2 } from "lucide-react";
import {
  deleteCommentAdmin,
  listAllComments,
  setCommentHidden,
} from "@/lib/admin/clube-moderation.functions";

export function ClubeModerationManager() {
  const fetchAll = useServerFn(listAllComments);
  const setHidden = useServerFn(setCommentHidden);
  const remove = useServerFn(deleteCommentAdmin);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-club-moderation"],
    queryFn: () => fetchAll(),
  });

  const hideMut = useMutation({
    mutationFn: (vars: { commentId: string; hidden: boolean }) =>
      setHidden({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-club-moderation"] }),
  });
  const delMut = useMutation({
    mutationFn: (commentId: string) => remove({ data: { commentId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-club-moderation"] }),
  });

  const stats = data?.stats;
  const comments = data?.comments ?? [];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<MessageSquare className="h-4 w-4" />} label="Comentários" value={stats?.totalComments ?? 0} />
        <StatTile icon={<EyeOff className="h-4 w-4" />} label="Ocultos" value={stats?.hiddenComments ?? 0} />
        <StatTile icon={<Heart className="h-4 w-4" />} label="Favoritos" value={stats?.totalFavorites ?? 0} />
        <StatTile icon={<Award className="h-4 w-4" />} label="Certificados" value={stats?.totalCertificates ?? 0} accent />
      </div>

      <div className="rounded-2xl border border-admin-border bg-admin-surface">
        <div className="p-4 border-b border-admin-border">
          <h3 className="font-display text-sm uppercase tracking-wider text-admin-ink">
            Últimos comentários
          </h3>
          <p className="text-xs text-admin-ink-muted mt-1">
            Oculte ou apague mensagens que violem as regras da comunidade.
          </p>
        </div>
        {isLoading ? (
          <p className="p-6 text-sm text-admin-ink-muted">Carregando…</p>
        ) : comments.length === 0 ? (
          <p className="p-6 text-sm text-admin-ink-muted">Sem comentários ainda.</p>
        ) : (
          <ul className="divide-y divide-admin-border">
            {comments.map((c) => (
              <li key={c.id} className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-display text-admin-ink">{c.author_name}</span>
                    <span className="text-admin-ink-muted">em</span>
                    <span className="text-admin-accent">{c.lesson_title}</span>
                    <span className="text-admin-ink-muted">
                      · {new Date(c.created_at).toLocaleString("pt-BR")}
                    </span>
                    {c.is_hidden && (
                      <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] uppercase text-red-500">
                        Oculto
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm font-body text-admin-ink whitespace-pre-wrap">
                    {c.body}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() =>
                      hideMut.mutate({ commentId: c.id, hidden: !c.is_hidden })
                    }
                    className="p-2 rounded-lg hover:bg-admin-bg text-admin-ink-soft hover:text-admin-ink"
                    title={c.is_hidden ? "Mostrar" : "Ocultar"}
                  >
                    {c.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm("Apagar este comentário?")) delMut.mutate(c.id);
                    }}
                    className="p-2 rounded-lg hover:bg-red-500/10 text-admin-ink-soft hover:text-red-500"
                    title="Apagar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        accent
          ? "bg-admin-accent-soft border-admin-accent/30"
          : "bg-admin-bg border-admin-border"
      }`}
    >
      <div className="flex items-center gap-2 text-admin-ink-muted">
        {icon}
        <span className="text-[10px] uppercase tracking-widest font-display">{label}</span>
      </div>
      <div className="font-display text-3xl font-bold text-admin-ink tabular-nums mt-1">
        {value}
      </div>
    </div>
  );
}
