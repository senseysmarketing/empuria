import { createServerFn } from "@tanstack/react-start";
import { requireStaff } from "./auth";

export type WiseEventRow = {
  id: string;
  event_id: string | null;
  event_type: string;
  signature_valid: boolean | null;
  match_status: string | null;
  matched_payment_id: string | null;
  matched_order_id: string | null;
  processed_at: string | null;
  created_at: string;
  notes: string | null;
  reference: string | null;
  amount_cents: number | null;
  currency: string | null;
  state: string | null;
  matched_order_code: string | null;
  matched_pdv_reference: string | null;
  payload_json: string;
};

function pickReference(p: Record<string, unknown>): string | null {
  const data = p.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    p.reference,
    data?.reference,
    data?.description,
    (data as Record<string, unknown> | undefined)?.transaction_reference,
    (data as Record<string, unknown> | undefined)?.merchant_reference,
    resource?.reference,
    resource?.description,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const pdv = c.match(/PDV-[A-Z0-9]+-A\d+/i);
      if (pdv) return pdv[0].toUpperCase();
      const emp = c.match(/EMP-\d{3,}/i);
      if (emp) return emp[0].toUpperCase();
      if (c.trim()) return c.trim();
    }
  }
  return null;
}

function pickAmountCents(p: Record<string, unknown>): number | null {
  const data = p.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    p.amount,
    data?.amount,
    resource?.amount,
    (data?.amount as Record<string, unknown> | undefined)?.value,
    (resource?.amount as Record<string, unknown> | undefined)?.value,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return Math.round(c * 100);
  }
  return null;
}

function pickCurrency(p: Record<string, unknown>): string | null {
  const data = p.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    p.currency,
    data?.currency,
    resource?.currency,
    (data?.amount as Record<string, unknown> | undefined)?.currency,
    (resource?.amount as Record<string, unknown> | undefined)?.currency,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().toUpperCase();
  }
  return null;
}

function pickState(p: Record<string, unknown>): string | null {
  const data = p.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    data?.current_state,
    (data as Record<string, unknown> | undefined)?.state,
    (data as Record<string, unknown> | undefined)?.status,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export const listWiseEvents = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (table: string) => any;
    };

    const { data, error } = await db
      .from("wise_events")
      .select(
        "id, event_id, event_type, signature_valid, match_status, matched_payment_id, matched_order_id, processed_at, created_at, notes, payload",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<Record<string, unknown>>;

    const orderIds = [
      ...new Set(rows.map((r) => r.matched_order_id).filter(Boolean)),
    ] as string[];
    const paymentIds = [
      ...new Set(rows.map((r) => r.matched_payment_id).filter(Boolean)),
    ] as string[];

    const orderMap = new Map<string, string>();
    if (orderIds.length) {
      const { data: orders } = await db
        .from("orders")
        .select("id, code")
        .in("id", orderIds);
      for (const o of (orders ?? []) as Array<{ id: string; code: string | null }>) {
        orderMap.set(o.id, o.code ?? o.id.slice(0, 8));
      }
    }

    const pdvMap = new Map<string, string>();
    if (paymentIds.length) {
      const { data: pdv } = await db
        .from("pdv_payment_attempts")
        .select("id, reference")
        .in("id", paymentIds);
      for (const p of (pdv ?? []) as Array<{ id: string; reference: string }>) {
        pdvMap.set(p.id, p.reference);
      }
    }

    return rows.map((r): WiseEventRow => {
      const payload = (r.payload as Record<string, unknown> | null) ?? {};
      return {
        id: r.id as string,
        event_id: (r.event_id as string) ?? null,
        event_type: (r.event_type as string) ?? "unknown",
        signature_valid: (r.signature_valid as boolean) ?? null,
        match_status: (r.match_status as string) ?? null,
        matched_payment_id: (r.matched_payment_id as string) ?? null,
        matched_order_id: (r.matched_order_id as string) ?? null,
        processed_at: (r.processed_at as string) ?? null,
        created_at: r.created_at as string,
        notes: (r.notes as string) ?? null,
        reference: pickReference(payload),
        amount_cents: pickAmountCents(payload),
        currency: pickCurrency(payload),
        state: pickState(payload),
        matched_order_code: r.matched_order_id
          ? orderMap.get(r.matched_order_id as string) ?? null
          : null,
        matched_pdv_reference: r.matched_payment_id
          ? pdvMap.get(r.matched_payment_id as string) ?? null
          : null,
        payload_json: JSON.stringify(payload),
      };
    });
  });
