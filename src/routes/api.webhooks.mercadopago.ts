import { createFileRoute } from "@tanstack/react-router";
import {
  processMercadoPagoWebhook,
  validateMercadoPagoWebhook,
} from "@/lib/mercadopago/mercadopago.functions";

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const Route = createFileRoute("/api/webhooks/mercadopago")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const raw = await request.text();
        let payload: Record<string, unknown>;
        try {
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
        }

        const auth = await validateMercadoPagoWebhook(request, payload);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: 401 });
        }

        const fallbackEventId = await sha256Hex(raw);
        const result = await processMercadoPagoWebhook(payload, fallbackEventId);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
      GET: async () =>
        Response.json({
          ok: true,
          provider: "mercadopago",
          message: "Mercado Pago webhook endpoint is online. Use POST with signed events.",
        }),
    },
  },
});
