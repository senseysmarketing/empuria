import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { processUazapiWebhook, validateUazapiWebhookSecret } from "@/lib/uazapi/uazapi.functions";

export const Route = createFileRoute("/api/webhooks/uazapi")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = await validateUazapiWebhookSecret(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.message }, { status: 401 });
        }

        const raw = await request.text();
        let payload: Record<string, unknown>;
        try {
          payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          return Response.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
        }

        const fallbackEventId = createHash("sha256").update(raw).digest("hex");
        const result = await processUazapiWebhook(payload, fallbackEventId);
        return Response.json(result, { status: result.ok ? 200 : 500 });
      },
      GET: async () =>
        Response.json({
          ok: true,
          provider: "uazapi",
          message: "Uazapi webhook endpoint is online. Use POST with the configured secret.",
        }),
    },
  },
});
