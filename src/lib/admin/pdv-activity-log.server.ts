/**
 * Server-only helper for detailed PDV activity logging.
 * Stores rich, queryable records in `pdv_activity_logs` for every action,
 * including failures and denied attempts. Never throws — failures here
 * must not break the originating business flow.
 */
import { getRequest } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PdvActivityStatus = "success" | "error" | "denied";

export type PdvActivityLogInput = {
  action: string;
  status?: PdvActivityStatus;
  actorId?: string | null;
  tabId?: string | null;
  tabCode?: string | null;
  saleId?: string | null;
  saleCode?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  productId?: string | null;
  productName?: string | null;
  amountEurCents?: number | null;
  paymentMethod?: string | null;
  reference?: string | null;
  route?: string | null;
  params?: unknown;
  result?: unknown;
  errorMessage?: string | null;
  errorCode?: string | null;
};

function pickRequestMeta(): { ip: string | null; userAgent: string | null } {
  try {
    const req = getRequest();
    if (!req) return { ip: null, userAgent: null };
    const xfwd = req.headers.get("x-forwarded-for");
    const ip =
      (xfwd ? xfwd.split(",")[0].trim() : null) ??
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-real-ip") ??
      null;
    const userAgent = req.headers.get("user-agent");
    return { ip, userAgent };
  } catch {
    return { ip: null, userAgent: null };
  }
}

function classifyError(err: unknown): { status: PdvActivityStatus; message: string; code: string | null } {
  const message = err instanceof Error ? err.message : String(err ?? "Unknown error");
  const lower = message.toLowerCase();
  const denied =
    lower.includes("sem permiss") ||
    lower.includes("permission") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("row-level security") ||
    lower.includes("rls");
  return {
    status: denied ? "denied" : "error",
    message: message.slice(0, 1000),
    // Postgres error codes (e.g. "23505") are surfaced on Supabase errors; capture if present.
    code: typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code ?? "") || null : null,
  };
}

async function hydrateNames(input: PdvActivityLogInput): Promise<{
  customerName: string | null;
  productName: string | null;
  tabCode: string | null;
  saleCode: string | null;
  actorName: string | null;
}> {
  const out = {
    customerName: input.customerName ?? null,
    productName: input.productName ?? null,
    tabCode: input.tabCode ?? null,
    saleCode: input.saleCode ?? null,
    actorName: null as string | null,
  };
  try {
    const lookups: Promise<unknown>[] = [];
    if (!out.customerName && input.customerId) {
      lookups.push(
        supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", input.customerId)
          .maybeSingle()
          .then((r: { data: { full_name: string } | null }) => {
            if (r.data?.full_name) out.customerName = r.data.full_name;
          }),
      );
    }
    if (!out.productName && input.productId) {
      lookups.push(
        supabaseAdmin
          .from("products")
          .select("name")
          .eq("id", input.productId)
          .maybeSingle()
          .then((r: { data: { name: string } | null }) => {
            if (r.data?.name) out.productName = r.data.name;
          }),
      );
    }
    if (!out.tabCode && input.tabId) {
      lookups.push(
        supabaseAdmin
          .from("pdv_tabs")
          .select("tab_code,customer_id")
          .eq("id", input.tabId)
          .maybeSingle()
          .then((r: { data: { tab_code: string; customer_id: string } | null }) => {
            if (r.data?.tab_code) out.tabCode = r.data.tab_code;
          }),
      );
    }
    if (!out.saleCode && input.saleId) {
      lookups.push(
        supabaseAdmin
          .from("pdv_sales")
          .select("sale_code")
          .eq("id", input.saleId)
          .maybeSingle()
          .then((r: { data: { sale_code: string } | null }) => {
            if (r.data?.sale_code) out.saleCode = r.data.sale_code;
          }),
      );
    }
    if (input.actorId) {
      lookups.push(
        supabaseAdmin
          .from("profiles")
          .select("full_name")
          .eq("id", input.actorId)
          .maybeSingle()
          .then((r: { data: { full_name: string } | null }) => {
            out.actorName = r.data?.full_name ?? null;
          }),
      );
    }
    await Promise.allSettled(lookups);
  } catch {
    // intentionally swallow — logger never blocks the main flow
  }
  return out;
}

export async function logPdvActivity(input: PdvActivityLogInput): Promise<void> {
  try {
    const { ip, userAgent } = pickRequestMeta();
    const names = await hydrateNames(input);
    await supabaseAdmin.from("pdv_activity_logs").insert({
      actor_id: input.actorId ?? null,
      actor_name: names.actorName,
      action: input.action,
      status: input.status ?? "success",
      source: "server_fn",
      tab_id: input.tabId ?? null,
      tab_code: names.tabCode,
      sale_id: input.saleId ?? null,
      sale_code: names.saleCode,
      customer_id: input.customerId ?? null,
      customer_name: names.customerName,
      product_id: input.productId ?? null,
      product_name: names.productName,
      amount_eur_cents: input.amountEurCents ?? null,
      payment_method: input.paymentMethod ?? null,
      reference: input.reference ?? null,
      request_ip: ip,
      user_agent: userAgent,
      route: input.route ?? null,
      params: (input.params ?? null) as never,
      result: (input.result ?? null) as never,
      error_message: input.errorMessage ?? null,
      error_code: input.errorCode ?? null,
    });
  } catch (err) {
    // Never throw from logger.
    console.warn("[pdv-activity-log] insert failed", {
      action: input.action,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Convenience wrapper for the standard "run RPC, log result or error" pattern.
 */
export async function withPdvLog<T>(
  ctx: Omit<PdvActivityLogInput, "status" | "result" | "errorMessage" | "errorCode">,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await logPdvActivity({
      ...ctx,
      status: "success",
      result: (result ?? null) as unknown,
    });
    return result;
  } catch (err) {
    const cls = classifyError(err);
    await logPdvActivity({
      ...ctx,
      status: cls.status,
      errorMessage: cls.message,
      errorCode: cls.code,
    });
    throw err;
  }
}
