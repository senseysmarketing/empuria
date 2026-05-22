import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyServices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: orders } = await supabase
      .from("orders")
      .select(
        "id,service_id,service_title,amount_cents,currency,payment_status,delivery_status,voucher_code,service_metadata,slot_id,host_profile_id,assigned_staff_id,created_at,executed_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    const list = orders ?? [];
    const serviceIds = Array.from(new Set(list.map((o) => o.service_id).filter(Boolean) as string[]));
    const slotIds = list.map((o) => o.slot_id).filter(Boolean) as string[];
    const hostIds = list.map((o) => o.host_profile_id).filter(Boolean) as string[];

    const [{ data: services }, { data: slots }, { data: hosts }, { data: docs }] = await Promise.all([
      serviceIds.length
        ? supabase
            .from("services")
            .select("id,slug,kind,title,meeting_address,short_description,document_checklist")
            .in("id", serviceIds)
        : Promise.resolve({ data: [] as never[] }),
      slotIds.length
        ? supabase
            .from("availability_slots")
            .select("id,starts_at,ends_at")
            .in("id", slotIds)
        : Promise.resolve({ data: [] as never[] }),
      hostIds.length
        ? supabase
            .from("profiles")
            .select("id,full_name,avatar_url,phone")
            .in("id", hostIds)
        : Promise.resolve({ data: [] as never[] }),
      list.length
        ? supabase
            .from("order_documents")
            .select("*")
            .in(
              "order_id",
              list.map((o) => o.id),
            )
            .order("position", { ascending: true })
        : Promise.resolve({ data: [] as never[] }),
    ]);

    return {
      orders: list,
      services: services ?? [],
      slots: slots ?? [],
      hosts: hosts ?? [],
      documents: docs ?? [],
    };
  });

export const toggleOrderDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), checked: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("order_documents")
      .update({ checked: data.checked, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const markDocumentsReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: order } = await supabase
      .from("orders")
      .select("id,user_id")
      .eq("id", data.orderId)
      .single();
    if (!order || order.user_id !== userId) throw new Error("Pedido não encontrado");
    const { error } = await supabase
      .from("orders")
      .update({ delivery_status: "processando" })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
