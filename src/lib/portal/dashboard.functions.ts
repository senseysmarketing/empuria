import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getPortalDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();

    const [profileRes, ordersRes, apptRes, suggestedRes] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("orders")
        .select(
          "id,service_title,payment_status,delivery_status,amount_cents,currency,voucher_code,created_at,service_id,slot_id",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("appointments")
        .select("id, starts_at, ends_at, status, service_id, services(title, kind, meeting_address)")
        .eq("user_id", userId)
        .gte("starts_at", nowIso)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabase
        .from("services")
        .select("id, slug, title, short_description, kind, price_cents, currency, image_url")
        .eq("is_active", true)
        .eq("category", "esteira1")
        .limit(3),
    ]);

    const orders = ordersRes.data ?? [];
    const activeOrders = orders.filter(
      (o) => o.payment_status === "aprovado" && o.delivery_status !== "concluido",
    );
    const pendingPayment = orders.filter((o) => o.payment_status !== "aprovado").length;

    return {
      profile: profileRes.data,
      nextAppointment: apptRes.data?.[0] ?? null,
      upcomingAppointments: apptRes.data ?? [],
      orders,
      metrics: {
        activeServices: activeOrders.length,
        pendingPayment,
        vouchers: orders.filter((o) => o.voucher_code).length,
        isClubMember: !!profileRes.data?.is_club_member,
      },
      suggested: suggestedRes.data ?? [],
    };
  });
