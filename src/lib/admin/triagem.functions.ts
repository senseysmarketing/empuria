import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const listLeadsKanban = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(300);
    return data ?? [];
  });

export const updateLeadStage = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      stage: z.enum(["novo", "em_contato", "reuniao", "fechado", "descartado", "analise", "qualificado"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({ pipeline_stage: data.stage })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateLeadNotes = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      id: z.string().uuid(),
      notes: z.string().max(4000).optional(),
      qualification_score: z.number().int().min(0).max(100).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("leads")
      .update({
        notes: data.notes ?? null,
        qualification_score: data.qualification_score ?? null,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listLeadActivity = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("lead_activity_log")
      .select("*")
      .eq("lead_id", data.leadId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const addLeadNote = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ leadId: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error: aErr } = await context.supabase
      .from("lead_activity_log")
      .insert({
        lead_id: data.leadId,
        kind: "note_added",
        payload: { body: data.body },
        actor_id: context.userId,
      });
    if (aErr) throw new Error(aErr.message);

    // Append timestamped to notes column for quick scanning
    const { data: cur } = await context.supabase
      .from("leads")
      .select("notes")
      .eq("id", data.leadId)
      .single();
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prepended = `[${stamp}] ${data.body}\n${cur?.notes ?? ""}`.trim();
    await context.supabase.from("leads").update({ notes: prepended }).eq("id", data.leadId);
    return { ok: true };
  });

export const logWhatsappOpened = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ leadId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("lead_activity_log")
      .insert({
        lead_id: data.leadId,
        kind: "whatsapp_opened",
        payload: {},
        actor_id: context.userId,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
