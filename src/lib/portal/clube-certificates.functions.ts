import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function makeCode(prefix: string) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

export const listMyCertificates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data, error } = await supabase
      .from("club_certificates")
      .select("id, scope, module_id, code, issued_at")
      .eq("user_id", userId)
      .order("issued_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { certificates: data ?? [] };
  });

export const claimCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        scope: z.enum(["module", "club"]),
        moduleId: z.string().uuid().nullable().optional(),
      })
      .parse(d)
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_club_member, full_name")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.is_club_member) throw new Error("Apenas membros podem emitir certificados.");

    // valida 100% concluído
    const lessonsQ = supabase
      .from("club_lessons")
      .select("id, module_id, is_published, is_coming_soon");
    const { data: allLessons } = data.scope === "module" && data.moduleId
      ? await lessonsQ.eq("module_id", data.moduleId)
      : await lessonsQ;

    const required = ((allLessons ?? []) as Array<{
      id: string;
      module_id: string;
      is_published: boolean;
      is_coming_soon: boolean | null;
    }>).filter((l) => l.is_published && !l.is_coming_soon);

    if (required.length === 0) throw new Error("Não há aulas disponíveis para concluir.");

    const { data: prog } = await supabase
      .from("club_lesson_progress")
      .select("lesson_id, completed_at")
      .eq("user_id", userId);
    const completedSet = new Set(
      ((prog ?? []) as Array<{ lesson_id: string; completed_at: string | null }>)
        .filter((p) => p.completed_at)
        .map((p) => p.lesson_id)
    );
    const missing = required.filter((l) => !completedSet.has(l.id));
    if (missing.length > 0)
      throw new Error(`Você ainda tem ${missing.length} aula(s) para concluir.`);

    const code = makeCode(data.scope === "club" ? "EMP-CLUBE" : "EMP-MOD");
    const row = {
      user_id: userId,
      scope: data.scope,
      module_id: data.scope === "module" ? data.moduleId : null,
      code,
    };
    const { data: inserted, error } = await supabase
      .from("club_certificates")
      .upsert(row, { onConflict: "user_id,scope,module_id" })
      .select("id, code, scope, module_id, issued_at")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { certificate: inserted };
  });

export const getCertificateByCode = createServerFn({ method: "GET" })
  .inputValidator((d) => z.object({ code: z.string().min(3).max(64) }).parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseAdmin as any;
    const { data: cert } = await sb
      .from("club_certificates")
      .select("id, code, scope, module_id, user_id, issued_at")
      .eq("code", data.code)
      .maybeSingle();
    if (!cert) return { certificate: null };

    const [{ data: profile }, moduleRes] = await Promise.all([
      sb.from("profiles").select("full_name").eq("id", cert.user_id).maybeSingle(),
      cert.module_id
        ? sb.from("club_modules").select("title").eq("id", cert.module_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    return {
      certificate: {
        code: cert.code,
        scope: cert.scope as "module" | "club",
        issued_at: cert.issued_at,
        recipient_name: profile?.full_name ?? "Membro do Clube",
        module_title: (moduleRes?.data as { title?: string } | null)?.title ?? null,
      },
    };
  });
