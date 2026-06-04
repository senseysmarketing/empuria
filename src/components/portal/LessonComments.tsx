import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import {
  addLessonComment,
  deleteLessonComment,
  listLessonComments,
} from "@/lib/portal/clube-social.functions";

export function LessonComments({ lessonId }: { lessonId: string }) {
  const fetchComments = useServerFn(listLessonComments);
  const addComment = useServerFn(addLessonComment);
  const deleteComment = useServerFn(deleteLessonComment);
  const qc = useQueryClient();
  const [body, setBody] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["club-comments", lessonId],
    queryFn: () => fetchComments({ data: { lessonId } }),
  });

  const addMut = useMutation({
    mutationFn: () => addComment({ data: { lessonId, body: body.trim() } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["club-comments", lessonId] });
    },
  });

  const delMut = useMutation({
    mutationFn: (commentId: string) => deleteComment({ data: { commentId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["club-comments", lessonId] }),
  });

  const visible = (data?.comments ?? []).filter((c) => !c.is_hidden || c.is_mine);

  return (
    <section className="rounded-3xl border border-admin-border bg-admin-surface p-5 md:p-6">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="h-4 w-4 text-admin-accent" />
        <h3 className="font-display text-sm uppercase tracking-[0.25em] text-admin-ink-soft">
          Comentários
        </h3>
        <span className="text-xs text-admin-ink-muted">({visible.length})</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim().length === 0) return;
          addMut.mutate();
        }}
        className="flex gap-2 mb-5"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Compartilhe sua dúvida, experiência ou recado…"
          className="flex-1 resize-none rounded-xl border border-admin-border bg-admin-bg px-3 py-2 text-sm font-body text-admin-ink placeholder:text-admin-ink-muted focus:outline-none focus:ring-2 focus:ring-admin-accent/40"
        />
        <button
          type="submit"
          disabled={addMut.isPending || body.trim().length === 0}
          className="self-end inline-flex items-center gap-1 rounded-xl bg-orange-brand px-4 py-2 text-xs font-display uppercase tracking-wider text-white hover:bg-orange-brand/90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> Enviar
        </button>
      </form>

      {isLoading ? (
        <p className="text-sm text-admin-ink-muted">Carregando comentários…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-admin-ink-muted">Seja o primeiro a comentar.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-admin-border bg-admin-bg p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {c.author_avatar ? (
                    <img
                      src={c.author_avatar}
                      alt=""
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-admin-accent-soft text-admin-accent flex items-center justify-center text-[10px] font-display shrink-0">
                      {(c.author_name ?? "M").slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-display text-admin-ink truncate">
                      {c.author_name}
                      {c.is_hidden && (
                        <span className="ml-2 text-[10px] uppercase text-admin-ink-muted">
                          oculto
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-admin-ink-muted">
                      {new Date(c.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                </div>
                {c.is_mine && (
                  <button
                    onClick={() => delMut.mutate(c.id)}
                    className="text-admin-ink-muted hover:text-red-500"
                    aria-label="Apagar"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <p className="mt-2 text-sm text-admin-ink whitespace-pre-wrap font-body">
                {c.body}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
