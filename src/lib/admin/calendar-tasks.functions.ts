import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const StatusSchema = z.enum(["pendente", "em_andamento", "concluida", "cancelada"]);
const PrioritySchema = z.enum(["baixa", "media", "alta", "urgente"]);

const CreateInput = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  priority: PrioritySchema.default("media"),
  due_at: z.string().datetime().optional(),
  assignee_id: z.string().uuid().optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
});

export const listCalendarTasks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("calendar_tasks")
      .select("*")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listWeekCalendarTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ weekStart: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const start = new Date(data.weekStart);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("calendar_tasks")
      .select("*")
      .gte("due_at", start.toISOString())
      .lt("due_at", end.toISOString())
      .order("due_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createCalendarTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("calendar_tasks")
      .insert({
        title: data.title,
        description: data.description ?? null,
        priority: data.priority,
        due_at: data.due_at ?? null,
        assignee_id: data.assignee_id ?? null,
        tags: data.tags ?? [],
        created_by: userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateCalendarTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), status: StatusSchema }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch = {
      status: data.status,
      completed_at: data.status === "concluida" ? new Date().toISOString() : null,
    };
    const { error } = await supabase.from("calendar_tasks").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteCalendarTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("calendar_tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
