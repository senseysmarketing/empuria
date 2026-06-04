import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";

export const getCockpitMetrics = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const isAdmin = !!context.isAdmin;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const isoToday = startOfDay.toISOString();
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);
    const isoTomorrow = endOfDay.toISOString();
    const thirtyDaysAgo = new Date(startOfDay);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    const [todayOrders, monthlyMembers, todayAppts, revenue30d, upcoming, arrivals] = await Promise.all([
      isAdmin
        ? supabase.from("orders").select("amount_cents,currency,payment_status")
            .gte("created_at", isoToday).lt("created_at", isoTomorrow)
            .eq("payment_status", "aprovado")
        : Promise.resolve({ data: [] }),
      supabase.from("profiles").select("id", { count: "exact", head: true })
        .eq("is_club_member", true).gte("updated_at", thirtyDaysAgo.toISOString()),
      supabase.from("appointments").select("id,starts_at,status,services(title),profiles(full_name)")
        .gte("starts_at", isoToday).lt("starts_at", isoTomorrow)
        .order("starts_at", { ascending: true }),
      isAdmin
        ? supabase.from("orders").select("created_at,amount_cents")
            .gte("created_at", thirtyDaysAgo.toISOString())
            .eq("payment_status", "aprovado")
        : Promise.resolve({ data: [] }),
      supabase.from("appointments").select("id,starts_at,services(title),profiles(full_name),staff_assignments(staff_id)")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true }).limit(5),
      supabase.from("arrivals").select("id,visitor_name,purpose,arrived_at")
        .gte("arrived_at", isoToday).order("arrived_at", { ascending: false }),
    ]);

    const salesTodayByCurrency = { BRL: 0, EUR: 0 };
    for (const o of todayOrders.data ?? []) {
      const cur = (o.currency === "EUR" ? "EUR" : "BRL") as "BRL" | "EUR";
      salesTodayByCurrency[cur] += (o.amount_cents ?? 0) / 100;
    }

    // Bucket by day
    const buckets: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(startOfDay);
      d.setDate(d.getDate() - (29 - i));
      buckets[d.toISOString().slice(0, 10)] = 0;
    }
    for (const o of revenue30d.data ?? []) {
      const key = (o.created_at as string).slice(0, 10);
      if (key in buckets) buckets[key] += (o.amount_cents ?? 0) / 100;
    }
    const revenueSeries = Object.entries(buckets).map(([date, value]) => ({ date, value }));

    return {
      salesTodayByCurrency,
      canViewFinancials: isAdmin,
      newMembers: monthlyMembers.count ?? 0,
      appointmentsToday: (todayAppts.data ?? []).length,
      todayAppointments: todayAppts.data ?? [],
      upcomingAppointments: upcoming.data ?? [],
      revenueSeries: isAdmin ? revenueSeries : [],
      todayArrivals: arrivals.data ?? [],
    };
  });

export const getActivityFeed = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("activity_feed")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!context.isAdmin) {
      return (data ?? []).map((item) =>
        item.type === "order_created" || item.type === "order_paid"
          ? { ...item, description: "Pedido atualizado" }
          : item,
      );
    }
    return data ?? [];
  });

const arrivalSchema = z.object({
  visitor_name: z.string().trim().min(2).max(120),
  purpose: z.string().trim().max(200).optional(),
  lead_id: z.string().uuid().optional().nullable(),
  user_id: z.string().uuid().optional().nullable(),
});

export const registerArrival = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => arrivalSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("arrivals").insert({
      visitor_name: data.visitor_name,
      purpose: data.purpose ?? null,
      lead_id: data.lead_id ?? null,
      user_id: data.user_id ?? null,
      registered_by: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const searchPeople = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ q: z.string().trim().max(80) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.q) return { leads: [], profiles: [] };
    const like = `%${data.q}%`;
    const [leads, profiles] = await Promise.all([
      context.supabase.from("leads").select("id,full_name,email").or(`full_name.ilike.${like},email.ilike.${like}`).limit(5),
      context.supabase.from("profiles").select("id,full_name").ilike("full_name", like).limit(5),
    ]);
    return { leads: leads.data ?? [], profiles: profiles.data ?? [] };
  });
