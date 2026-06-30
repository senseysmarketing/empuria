import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withPdvLog } from "./pdv-activity-log.server";


const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
};

export type PdvWiseAttempt = {
  id: string;
  tab_id: string;
  reference: string;
  attempt_index: number;
  amount_eur_cents: number;
  amount_brl_cents: number;
  currency: string;
  status:
    | "waiting_payment"
    | "paid"
    | "cancelled"
    | "expired"
    | "pending_conciliation"
    | "failed";
  payment_url: string | null;
  customer_phone_snapshot: string | null;
  customer_name_snapshot: string | null;
  created_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
};

function appendQuickPayParams(
  url: string,
  params: { amount: number; currency: string; description?: string | null },
): string {
  try {
    const u = new URL(url);
    u.searchParams.set("amount", params.amount.toFixed(2));
    u.searchParams.set("currency", params.currency);
    if (params.description) u.searchParams.set("description", params.description);
    return u.toString();
  } catch {
    return url;
  }
}

async function loadWiseSetting() {
  const { data } = await db
    .from("integration_settings")
    .select("wise_default_payment_url,is_enabled")
    .eq("provider", "wise")
    .maybeSingle();
  return {
    defaultUrl: (data?.wise_default_payment_url as string | null) ?? null,
    enabled: !!data?.is_enabled,
  };
}

const requestSchema = z.object({
  tabId: z.string().uuid(),
  discount: z.object({
    type: z.enum(["none", "amount", "percent"]),
    value: z.number().min(0).max(100000),
  }),
  notes: z.string().trim().max(500).optional(),
});

export const requestPdvWisePayment = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => requestSchema.parse(data))
  .handler(async ({ data, context }) => {
    const setting = await loadWiseSetting();

    // Compute reference first via a "preview" — we need the URL, then send to RPC.
    // Strategy: call RPC with placeholder URL, retrieve reference, then build URL,
    // then patch the URL on the attempt.
    const { data: rpcRes, error } = await db.rpc("pdv_request_wise_payment", {
      p_tab_id: data.tabId,
      p_actor_id: context.userId,
      p_discount_type: data.discount.type,
      p_discount_value: data.discount.value,
      p_payment_url: null,
      p_notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);

    const reference = rpcRes.reference as string;
    const amountCents = rpcRes.amount_eur_cents as number;
    const attemptId = rpcRes.attempt_id as string;

    const finalUrl = setting.defaultUrl
      ? appendQuickPayParams(setting.defaultUrl, {
          amount: amountCents / 100,
          currency: "EUR",
          description: reference,
        })
      : null;

    if (finalUrl) {
      await db
        .from("pdv_payment_attempts")
        .update({ payment_url: finalUrl })
        .eq("id", attemptId);
    }

    return {
      attemptId,
      reference,
      amountEurCents: amountCents,
      amountBrlCents: rpcRes.amount_brl_cents as number,
      paymentUrl: finalUrl,
      manualOnly: !finalUrl,
      customerPhone: (rpcRes.customer_phone as string | null) ?? null,
      customerName: (rpcRes.customer_name as string | null) ?? null,
    };
  });

const cancelSchema = z.object({
  attemptId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const cancelPdvWiseAttempt = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => cancelSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await db.rpc("pdv_cancel_wise_attempt", {
      p_attempt_id: data.attemptId,
      p_actor_id: context.userId,
      p_reason: data.reason,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const recheckSchema = z.object({ attemptId: z.string().uuid() });

export const recheckPdvWiseAttempt = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => recheckSchema.parse(data))
  .handler(async ({ data }) => {
    const { data: row, error } = await db
      .from("pdv_payment_attempts")
      .select("id,status,paid_at,reference,amount_eur_cents")
      .eq("id", data.attemptId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Tentativa nao encontrada");
    return row;
  });

export const listPdvAwaitingPayments = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv")])
  .handler(async () => {
    const { data, error } = await db
      .from("pdv_payment_attempts")
      .select(
        "id,tab_id,reference,attempt_index,amount_eur_cents,amount_brl_cents,currency,status,payment_url,customer_phone_snapshot,customer_name_snapshot,created_at",
      )
      .eq("status", "waiting_payment")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PdvWiseAttempt[];
  });
