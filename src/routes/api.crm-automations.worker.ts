import { createFileRoute } from "@tanstack/react-router";
import { processCrmAutomationPendingActionsInternal } from "@/lib/admin/crm-automations.functions";
import { workerSecretIsValid } from "@/lib/admin/crm-automation.worker-auth";

function validateWorkerSecret(request: Request) {
  const expected = process.env.WHATSAPP_AUTOMATION_WORKER_SECRET;
  if (!expected) return { ok: false, status: 503, error: "Worker secret not configured" };

  if (!workerSecretIsValid(request.headers, expected)) {
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
