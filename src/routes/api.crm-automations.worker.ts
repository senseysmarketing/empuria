import { createFileRoute } from "@tanstack/react-router";
import { processCrmAutomationPendingActionsInternal } from "@/lib/admin/crm-automations.functions";

function validateWorkerSecret(request: Request) {
  const expected = process.env.WHATSAPP_AUTOMATION_WORKER_SECRET;
  if (!expected) return { ok: false, status: 503, error: "Worker secret not configured" };

  const auth = request.headers.get("authorization") ?? "";
  const candidates = [
    request.headers.get("x-cron-secret"),
    auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : null,
    new URL(request.url).searchParams.get("secret"),
  ].filter(Boolean);

  if (!candidates.some((candidate) => candidate === expected)) {
    return { ok: false, status: 401, error: "Invalid worker secret" };
  }
  return { ok: true, status: 200, error: null };
}

export const Route = createFileRoute("/api/crm-automations/worker")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = validateWorkerSecret(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }

        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 100);
        const result = await processCrmAutomationPendingActionsInternal(limit);
        return Response.json(result, { status: 200 });
      },
      GET: async ({ request }: { request: Request }) => {
        const auth = validateWorkerSecret(request);
        if (!auth.ok) {
          return Response.json({ ok: false, error: auth.error }, { status: auth.status });
        }
        return Response.json({
          ok: true,
          endpoint: "crm-automations-worker",
          message: "Use POST to process pending CRM automation actions.",
        });
      },
    },
  },
});
