import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profileRes, apptRes, rolesRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("appointments")
        .select("id, starts_at, ends_at, status, service_id, services(title)")
        .eq("user_id", userId)
        .order("starts_at", { ascending: true }),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);

    return {
      profile: profileRes.data,
      appointments: apptRes.data ?? [],
      roles: (rolesRes.data ?? []).map((r) => r.role as string),
    };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    const { data: isStaffRole } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "staff",
    });
    if (!isAdmin && !isStaffRole) throw new Error("Acesso negado");

    const [leadsRes, apptRes, membersRes] = await Promise.all([
      supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(100),
      supabase
        .from("appointments")
        .select("*, services(title), profiles(full_name)")
        .order("starts_at", { ascending: true })
        .limit(100),
      supabase.from("profiles").select("id, full_name, is_club_member, created_at").limit(100),
    ]);

    return {
      leads: leadsRes.data ?? [],
      appointments: apptRes.data ?? [],
      members: membersRes.data ?? [],
    };
  });

const leadSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(5).max(40),
  current_country: z.string().trim().max(80).optional(),
  target_visa: z.string().trim().max(120).optional(),
  budget_range: z.string().trim().max(80).optional(),
  timeline: z.string().trim().max(80).optional(),
  message: z.string().trim().max(2000).optional(),
});

export const submitLead = createServerFn({ method: "POST" })
  .inputValidator((d) => leadSchema.parse(d))
  .handler(async ({ data }) => {
    // Use admin import lazily to bypass RLS for anon lead capture
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("leads").insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
