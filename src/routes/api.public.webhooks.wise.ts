import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { verifyWiseWebhookSignature } from "@/lib/wise/wise-api.server";

const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

async function loadSetting() {
  const { data } = await db
    .from("integration_settings")
    .select("wise_webhook_public_key,wise_confirmation_mode")
    .eq("provider", "wise")
    .maybeSingle();
  return {
    publicKey: (data?.wise_webhook_public_key as string | null) ?? null,
    confirmationMode: (data?.wise_confirmation_mode as string | null) ?? "webhook_and_manual",
  };
}

type WisePayload = {
  event_type?: string;
  data?: {
    resource?: { profile_id?: number | string; type?: string };
    amount?: number;
    currency?: string;
    reference?: string;
    current_state?: string;
    occurred_at?: string;
  };
  // payment-link events
  reference?: string;
  amount?: number;
  currency?: string;
  // free-form
  [k: string]: unknown;
};

function pickReference(p: WisePayload): string | null {
  const data = p.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    p.reference,
    data?.reference,
    data?.description,
    data?.transaction_reference,
    data?.merchant_reference,
    resource?.reference,
    resource?.description,
  ];
  for (const c of candidates) {
    if (typeof c === "string") {
      const pdvMatch = c.match(/PDV-[A-Z0-9]+-A\d+/i);
      if (pdvMatch) return pdvMatch[0].toUpperCase();
      const empMatch = c.match(/EMP-\d{3,}/i);
      if (empMatch) return empMatch[0].toUpperCase();
      if (c.trim()) return c.trim();
    }
  }
  return null;
}

function pickAmountCents(p: WisePayload): number | null {
  const data = p.data as Record<string, unknown> | undefined;
  const resource = data?.resource as Record<string, unknown> | undefined;
  // amount may appear as number or as { value, currency }
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

function pickCurrency(p: WisePayload): string | null {
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

export const Route = createFileRoute("/api/public/webhooks/wise")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const raw = await request.text();
        let payload: WisePayload = {};
        try {
          payload = raw ? (JSON.parse(raw) as WisePayload) : {};
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
        }

        const setting = await loadSetting();
        const signature =
          request.headers.get("x-signature-sha256") ?? request.headers.get("X-Signature-SHA256") ?? "";
        const deliveryId =
          request.headers.get("x-delivery-id") ?? request.headers.get("X-Delivery-Id") ?? null;

        let signatureValid = false;
        if (setting.publicKey) {
          signatureValid = await verifyWiseWebhookSignature({
            publicKeyPem: setting.publicKey,
            signatureBase64: signature,
            rawBody: raw,
          });
        }
        // In sandbox or when no key configured, accept event but mark invalid.
        if (setting.publicKey && !signatureValid) {
          await db.from("wise_events").insert({
            event_id: deliveryId,
            event_type: payload.event_type ?? "unknown",
            payload,
            signature_valid: false,
            match_status: "ignored",
            notes: "Assinatura invalida",
          });
          return Response.json({ ok: false, error: "Invalid signature" }, { status: 401 });
        }

        // Idempotency by event_id
        if (deliveryId) {
          const { data: existing } = await db
            .from("wise_events")
            .select("id")
            .eq("event_id", deliveryId)
            .maybeSingle();
          if (existing) return Response.json({ ok: true, duplicate: true }, { status: 200 });
        }

        const reference = pickReference(payload);
        const amountCents = pickAmountCents(payload);
        const currency = pickCurrency(payload);

        let matchedPaymentId: string | null = null;
        let matchedOrderId: string | null = null;
        let matchStatus:
          | "auto_matched"
          | "pending"
          | "underpaid"
          | "overpaid"
          | "pdv_matched"
          | "pdv_pending" = "pending";

        if (reference) {
          const isPdvRef = /^PDV-[A-Z0-9]+-A\d+$/i.test(reference);
          if (isPdvRef) {
            const { data: rpcRes } = await db.rpc("pdv_confirm_wise_payment", {
              p_reference: reference,
              p_amount_cents: amountCents,
              p_currency: currency,
              p_raw: payload,
            });
            const res = (rpcRes ?? {}) as { matched?: boolean; sale_id?: string };
            matchStatus = res.matched ? "pdv_matched" : "pdv_pending";
          } else {
            const { data: payment } = await db
              .from("wise_payments")
              .select("id,order_id,amount_cents,currency,status")
              .eq("external_reference", reference)
              .maybeSingle();
            if (payment) {
              matchedPaymentId = payment.id as string;
              matchedOrderId = payment.order_id as string;
              const sameCurrency =
                !currency || String(currency).toUpperCase() === String(payment.currency).toUpperCase();
              if (sameCurrency && amountCents !== null) {
                if (amountCents === payment.amount_cents) matchStatus = "auto_matched";
                else if (amountCents < payment.amount_cents) matchStatus = "underpaid";
                else matchStatus = "overpaid";
              } else if (sameCurrency) {
                matchStatus = "auto_matched";
              }
              if (matchStatus === "auto_matched") {
                await db
                  .from("wise_payments")
                  .update({
                    status: "paid",
                    paid_at: new Date().toISOString(),
                    raw_webhook: payload,
                  })
                  .eq("id", payment.id);
                await db
                  .from("orders")
                  .update({ payment_status: "aprovado", paid_at: new Date().toISOString() })
                  .eq("id", payment.order_id);
              } else if (matchStatus === "underpaid" || matchStatus === "overpaid") {
                await db
                  .from("wise_payments")
                  .update({ status: matchStatus, raw_webhook: payload })
                  .eq("id", payment.id);
              }
            }
          }
        }

        await db.from("wise_events").insert({
          event_id: deliveryId,
          event_type: payload.event_type ?? "unknown",
          payload,
          signature_valid: signatureValid,
          matched_payment_id: matchedPaymentId,
          matched_order_id: matchedOrderId,
          match_status: matchStatus,
          processed_at: matchStatus === "auto_matched" ? new Date().toISOString() : null,
        });

        await db
          .from("integration_settings")
          .update({ wise_last_event_at: new Date().toISOString() })
          .eq("provider", "wise");

        return Response.json({ ok: true, matchStatus }, { status: 200 });
      },
      GET: async () =>
        Response.json({
          ok: true,
          provider: "wise",
          message: "Wise webhook endpoint online. POST signed events.",
        }),
    },
  },
});
