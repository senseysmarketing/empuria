import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const checkEmail = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ email: z.string().trim().email().max(255) }).parse(d))
  .handler(async ({ data }) => {
    const { data: exists, error } = await supabaseAdmin.rpc("email_exists", {
      p_email: data.email,
    });
    if (error) return { exists: false };
    return { exists: !!exists };
  });

export const getSlotsForService = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        serviceId: z.string().uuid(),
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const from = data.from ?? new Date().toISOString();
    const to = data.to ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString();
    const { data: slots } = await supabaseAdmin
      .from("availability_slots")
      .select("id,starts_at,ends_at,capacity,booked")
      .eq("service_id", data.serviceId)
      .eq("is_active", true)
      .gte("starts_at", from)
      .lte("starts_at", to)
      .order("starts_at", { ascending: true });
    return (slots ?? []).filter((s) => s.booked < s.capacity);
  });

const createIntentSchema = z.object({
  serviceSlug: z.string().trim().min(2).max(80),
  contact: z.object({
    name: z.string().trim().min(2).max(120),
    whatsapp: z.string().trim().min(6).max(40),
  }),
  serviceData: z
    .object({
      slotId: z.string().uuid().optional(),
      arrivalDate: z.string().optional(),
      arrivalTime: z.string().optional(),
      flightNumber: z.string().max(40).optional(),
      terminal: z.string().max(40).optional(),
      bagsCount: z.number().int().min(0).max(20).optional(),
      notes: z.string().max(500).optional(),
    })
    .default({}),
});

export const createCheckoutIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createIntentSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, claims } = context;
    const userId = context.effectiveUserId ?? context.userId;

    const { data: service, error: svcErr } = await supabase
      .from("services")
      .select("*")
      .eq("slug", data.serviceSlug)
      .eq("is_active", true)
      .single();
    if (svcErr || !service) throw new Error("Serviço indisponível");

    // Update profile basic info
    await supabase
      .from("profiles")
      .update({
        full_name: data.contact.name,
        phone: data.contact.whatsapp,
      })
      .eq("id", userId);

    let slotId: string | null = null;
    if (service.requires_slot) {
      if (!data.serviceData.slotId) throw new Error("Selecione um horário");
      // Atomic-ish slot reservation via supabaseAdmin
      const { data: slot } = await supabaseAdmin
        .from("availability_slots")
        .select("*")
        .eq("id", data.serviceData.slotId)
        .single();
      if (!slot || !slot.is_active) throw new Error("Vaga indisponível");
      if (new Date(slot.ends_at).getTime() <= Date.now()) throw new Error("Vaga já encerrada");
      if (slot.booked >= slot.capacity) throw new Error("Vaga lotada");
      const { error: updErr } = await supabaseAdmin
        .from("availability_slots")
        .update({ booked: slot.booked + 1 })
        .eq("id", slot.id)
        .eq("booked", slot.booked); // optimistic concurrency
      if (updErr) throw new Error("Não foi possível reservar a vaga");
      slotId = slot.id;
    }

    const customerEmail = typeof claims.email === "string" ? claims.email : null;

    const serviceRow = service as typeof service & {
      online_price_cents?: number | null;
      online_currency?: string | null;
    };
    const paymentAmountCents = serviceRow.online_price_cents ?? service.price_cents;
    const paymentCurrency = serviceRow.online_currency ?? service.currency ?? "BRL";

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        customer_name: data.contact.name,
        customer_email: customerEmail,
        service_id: service.id,
        service_title: service.title,
        amount_cents: paymentAmountCents,
        currency: paymentCurrency,
        slot_id: slotId,
        service_metadata: {
          ...data.serviceData,
          whatsapp: data.contact.whatsapp,
          original_price_cents: service.price_cents,
          original_currency: service.currency,
        },
        payment_status: "pendente",
        payment_provider: "mercadopago",
        payment_amount_cents: paymentAmountCents,
        payment_currency: paymentCurrency,
        external_reference: "pending",
      } as never)
      .select()
      .single();
    if (orderErr || !order) throw new Error(orderErr?.message ?? "Erro ao criar pedido");

    const reference = `EMP-${order.id}`;
    await supabaseAdmin
      .from("orders")
      .update({ external_reference: reference, payment_provider_reference: reference } as never)
      .eq("id", order.id);

    return {
      orderId: order.id,
      reference,
      amountCents: paymentAmountCents,
      currency: paymentCurrency,
    };
  });

export const confirmMockPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const userId = context.effectiveUserId ?? context.userId;
    const { data: order } = await supabase
      .from("orders")
      .select("id,user_id,payment_status")
      .eq("id", data.orderId)
      .single();
    if (!order || order.user_id !== userId) throw new Error("Pedido não encontrado");
    if (order.payment_status === "aprovado") return { ok: true };

    const { error } = await supabase
      .from("orders")
      .update({ payment_status: "aprovado" })
      .eq("id", order.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
