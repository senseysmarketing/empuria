import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getPortalDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const nowIso = new Date().toISOString();

    const [profileRes, ordersRes, apptRes, documentsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id,full_name,avatar_url,created_at,member_status,member_next_step")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("orders")
        .select(
          "id,service_title,payment_status,delivery_status,amount_cents,currency,voucher_code,created_at,service_id,slot_id",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase
        .from("appointments")
        .select(
          "id, starts_at, ends_at, status, service_id, services(title, kind, meeting_address)",
        )
        .eq("user_id", userId)
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(1),
      supabaseAdmin
        .from("member_documents")
        .select("id,status")
        .eq("user_id", userId)
        .eq("visible_to_member", true),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (ordersRes.error) throw new Error(ordersRes.error.message);
    if (apptRes.error) throw new Error(apptRes.error.message);
    if (documentsRes.error) throw new Error(documentsRes.error.message);
    const documents = documentsRes.data ?? [];

    return {
      profile: profileRes.data,
      nextAppointment: apptRes.data?.[0] ?? null,
      orders: ordersRes.data ?? [],
      documents: {
        total: documents.length,
        needsUpload: documents.filter(
          (d) => d.status === "requested" || d.status === "needs_replacement",
        ).length,
        underReview: documents.filter((d) => d.status === "received").length,
      },
    };
  });
