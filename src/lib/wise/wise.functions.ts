import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireStaff } from "@/lib/admin/auth";
import {
  listWiseAccountDetails,
  listWiseBalances,
  listWiseProfiles,
  type WiseClientOptions,
  type WiseEnvironment,
} from "./wise-api.server";



const db = supabaseAdmin as unknown as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args?: Record<string, unknown>) => Promise<any>;
};

export type WiseWebhookSubscription = {
  key: "balances#credit" | "transfers#state-change" | "transfers#active-cases" | string;
  enabled: boolean;
};

export type WiseSetting = {
  is_enabled: boolean;
  wise_environment: WiseEnvironment;
  wise_api_token: string | null;
  wise_profile_id: string | null;
  wise_profile_name: string | null;
  wise_profile_type: string | null;
  wise_balance_id_eur: string | null;
  wise_balance_currency: string | null;
  wise_beneficiary_name: string | null;
  wise_beneficiary_address: string | null;
  wise_iban: string | null;
  wise_bic: string | null;
  wise_bank_address: string | null;
  wise_default_payment_url: string | null;
  wise_webhook_public_key: string | null;
  wise_webhook_subscriptions: WiseWebhookSubscription[];
  wise_last_event_at: string | null;
  wise_confirmation_mode: string;
};

function tokenFromSettingOrEnv(setting: Pick<WiseSetting, "wise_api_token">) {
  return setting.wise_api_token ?? process.env.WISE_API_TOKEN ?? null;
}

/** Append amount/currency/description query params to a Wise Quick Pay URL
 *  so the payer lands on the Wise page with value + reference pre-filled. */
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


function maskedSetting(s: WiseSetting): WiseSetting {
  return {
    ...s,
    wise_api_token: s.wise_api_token ? "********" : null,
  };
}

async function loadSetting(): Promise<WiseSetting> {
  const { data } = await db
    .from("integration_settings")
    .select(
      "is_enabled,wise_environment,wise_api_token,wise_profile_id,wise_profile_name,wise_profile_type,wise_balance_id_eur,wise_balance_currency,wise_beneficiary_name,wise_beneficiary_address,wise_iban,wise_bic,wise_bank_address,wise_default_payment_url,wise_webhook_public_key,wise_webhook_subscriptions,wise_last_event_at,wise_confirmation_mode",
    )
    .eq("provider", "wise")
    .maybeSingle();
  const row = (data ?? null) as Partial<WiseSetting> | null;
  return {
    is_enabled: !!row?.is_enabled,
    wise_environment: (row?.wise_environment as WiseEnvironment) ?? "live",
    wise_api_token: row?.wise_api_token ?? null,
    wise_profile_id: row?.wise_profile_id ?? null,
    wise_profile_name: row?.wise_profile_name ?? null,
    wise_profile_type: row?.wise_profile_type ?? null,
    wise_balance_id_eur: row?.wise_balance_id_eur ?? null,
    wise_balance_currency: row?.wise_balance_currency ?? "EUR",
    wise_beneficiary_name: row?.wise_beneficiary_name ?? null,
    wise_beneficiary_address: row?.wise_beneficiary_address ?? null,
    wise_iban: row?.wise_iban ?? null,
    wise_bic: row?.wise_bic ?? null,
    wise_bank_address: row?.wise_bank_address ?? null,
    wise_default_payment_url: row?.wise_default_payment_url ?? null,
    wise_webhook_public_key: row?.wise_webhook_public_key ?? null,
    wise_webhook_subscriptions: Array.isArray(row?.wise_webhook_subscriptions)
      ? (row?.wise_webhook_subscriptions as WiseWebhookSubscription[])
      : [],
    wise_last_event_at: row?.wise_last_event_at ?? null,
    wise_confirmation_mode: row?.wise_confirmation_mode ?? "webhook_and_manual",
  };
}


export const getWiseAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async () => {
    const setting = await loadSetting();
    const { data: events } = await db
      .from("wise_events")
      .select("id,event_type,match_status,created_at,processed_at,signature_valid,notes")
      .order("created_at", { ascending: false })
      .limit(20);
    const { data: payments } = await db
      .from("wise_payments")
      .select("id,order_id,external_reference,status,amount_cents,currency,wise_payment_link_url,paid_at,created_at")
      .order("created_at", { ascending: false })
      .limit(20);

    const hasFallbackUrl = !!setting.wise_default_payment_url;

    return {
      setting: maskedSetting(setting),
      events: events ?? [],
      payments: payments ?? [],
      webhookUrl: "/api/public/webhooks/wise",
      hasEnvToken: !!process.env.WISE_API_TOKEN,
      lastApiError: null as { message: string; status: number | null; at: string } | null,
      lastApiSuccessAt: null as string | null,
      hasFallbackUrl,
    };
  });


/** Admin: try to create a real €1.00 payment-request to validate the API end-to-end. */
export const testWisePaymentCreation = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .handler(async () => {
    const setting = await loadSetting();
    const fallbackUrl = setting.wise_default_payment_url ?? null;
    const token = tokenFromSettingOrEnv(setting);
    if (!token) {
      return { ok: false, message: "Token Wise nao configurado.", link: null as string | null, fallbackUrl };
    }
    if (!setting.wise_profile_id) {
      return { ok: false, message: "Profile Wise nao selecionado.", link: null as string | null, fallbackUrl };
    }
    const ref = `EMP-TEST-${Date.now().toString().slice(-6)}`;
    const res = await createWisePaymentRequest(
      { token, environment: setting.wise_environment },
      setting.wise_profile_id,
      {
        amount: 1.0,
        currency: "EUR",
        reference: ref.slice(0, 35),
        description: "Empuria - teste de integracao Wise (1 EUR)",
        balanceId: setting.wise_balance_id_eur,
        metadata: { test: "true" },
      },
    );
    if (!res.ok) {
      return {
        ok: false,
        message: `API Wise respondeu ${res.status}: ${res.error}`,
        link: null as string | null,
        fallbackUrl,
        reference: ref,
      };
    }
    const link = pickHostedUrl(res.data);
    return {
      ok: true,
      message: link ? "Link hospedado gerado com sucesso." : "API aceitou mas nao retornou link hospedado.",
      link,
      fallbackUrl,
      reference: ref,
    };
  });


const webhookSubSchema = z.object({
  key: z.string().trim().min(1).max(60),
  enabled: z.boolean(),
});

const saveSchema = z.object({
  is_enabled: z.boolean(),
  wise_api_token: z.string().trim().min(1).max(500).nullable(),
  wise_profile_id: z.string().trim().max(60).nullable(),
  wise_profile_name: z.string().trim().max(200).nullable(),
  wise_profile_type: z.string().trim().max(40).nullable(),
  wise_balance_id_eur: z.string().trim().max(60).nullable(),
  wise_balance_currency: z.string().trim().max(8).nullable(),
  wise_beneficiary_name: z.string().trim().max(120).nullable(),
  wise_beneficiary_address: z.string().trim().max(300).nullable(),
  wise_iban: z.string().trim().max(60).nullable(),
  wise_bic: z.string().trim().max(20).nullable(),
  wise_bank_address: z.string().trim().max(300).nullable(),
  wise_default_payment_url: z.string().trim().url().max(500).nullable(),
  wise_webhook_public_key: z.string().trim().max(4000).nullable(),
  wise_webhook_subscriptions: z.array(webhookSubSchema).max(10).default([]),
  wise_confirmation_mode: z.enum(["webhook_only", "manual_only", "webhook_and_manual"]),
});

export const saveWiseSettings = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => saveSchema.parse(d))
  .handler(async ({ data }) => {
    // Preserve existing token if empty submitted
    const existing = await loadSetting();
    const tokenToWrite = data.wise_api_token ?? existing.wise_api_token;
    const { error } = await db
      .from("integration_settings")
      .update({
        is_enabled: data.is_enabled,
        wise_environment: "live",
        wise_api_token: tokenToWrite,
        wise_profile_id: data.wise_profile_id,
        wise_profile_name: data.wise_profile_name,
        wise_profile_type: data.wise_profile_type,
        wise_balance_id_eur: data.wise_balance_id_eur,
        wise_balance_currency: data.wise_balance_currency ?? "EUR",
        wise_beneficiary_name: data.wise_beneficiary_name,
        wise_beneficiary_address: data.wise_beneficiary_address,
        wise_iban: data.wise_iban,
        wise_bic: data.wise_bic,
        wise_bank_address: data.wise_bank_address,
        wise_default_payment_url: data.wise_default_payment_url,
        wise_webhook_public_key: data.wise_webhook_public_key,
        wise_webhook_subscriptions: data.wise_webhook_subscriptions,
        wise_confirmation_mode: data.wise_confirmation_mode,
      })
      .eq("provider", "wise");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Test the API token (or an override token) and return profiles. */
export const testWiseConnection = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ token: z.string().trim().min(10).max(500).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const setting = await loadSetting();
    const token = data.token ?? tokenFromSettingOrEnv(setting);
    if (!token) return { ok: false, message: "Token Wise nao configurado.", profiles: [] as Array<{ id: string; type: string; name: string | null }> };
    const client: WiseClientOptions = { token, environment: "live" };
    const res = await listWiseProfiles(client);
    if (!res.ok) return { ok: false, message: res.error, profiles: [] as Array<{ id: string; type: string; name: string | null }> };
    return {
      ok: true,
      message: `Wise OK · ${res.data.length} perfil(s) encontrado(s).`,
      profiles: res.data.map((p) => ({ id: String(p.id), type: p.type, name: p.fullName ?? null })),
    };
  });

/** List balances (saldos) of a given profile. */
export const listWiseProfileBalances = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        profileId: z.string().trim().min(1).max(60),
        token: z.string().trim().min(10).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const setting = await loadSetting();
    const token = data.token ?? tokenFromSettingOrEnv(setting);
    if (!token) return { ok: false, message: "Token Wise nao configurado.", balances: [] as Array<{ id: string; currency: string; name: string | null }> };
    const res = await listWiseBalances({ token, environment: "live" }, data.profileId);
    if (!res.ok) return { ok: false, message: res.error, balances: [] as Array<{ id: string; currency: string; name: string | null }> };
    return {
      ok: true,
      message: `Wise OK · ${res.data.length} saldo(s) encontrado(s).`,
      balances: res.data.map((b) => ({ id: String(b.id), currency: b.currency, name: b.name ?? null })),
    };
  });

/** Fetch EUR bank account details (IBAN/BIC/beneficiary/bank address) for a profile. */
export const fetchWiseEurBankDetails = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        profileId: z.string().trim().min(1).max(60),
        token: z.string().trim().min(10).max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const setting = await loadSetting();
    const token = data.token ?? tokenFromSettingOrEnv(setting);
    if (!token) return { ok: false, message: "Token Wise nao configurado.", details: null };
    const res = await listWiseAccountDetails({ token, environment: "live" }, data.profileId);
    if (!res.ok) return { ok: false, message: res.error, details: null };
    const eur = (res.data ?? []).find((a) => String(a.currency ?? "").toUpperCase() === "EUR");
    if (!eur || !eur.bankDetails) {
      return { ok: false, message: "Conta EUR sem dados bancarios disponiveis via API. Preencha manualmente.", details: null };
    }
    const b = eur.bankDetails;
    const bankAddr = b.bankAddress
      ? [b.bankAddress.addressFirstLine, b.bankAddress.city, b.bankAddress.postCode, b.bankAddress.country]
          .filter(Boolean)
          .join(", ")
      : null;
    const benAddr = b.address
      ? [b.address.addressFirstLine, b.address.city, b.address.postCode, b.address.country]
          .filter(Boolean)
          .join(", ")
      : null;
    return {
      ok: true,
      message: "Dados bancarios EUR carregados.",
      details: {
        iban: b.iban ?? null,
        bic: b.bic ?? b.swift ?? null,
        beneficiaryName: b.accountHolderName ?? null,
        beneficiaryAddress: benAddr,
        bankName: b.bankName ?? null,
        bankAddress: bankAddr,
      },
    };
  });



/* ============================================================
   Internal: called by checkout to mint a Wise payment for an order.
   ============================================================ */

export async function createWisePaymentForOrder(args: {
  orderId: string;
  amountCents: number;
  currency: string;
  description: string;
  customerEmail?: string | null;
}): Promise<{
  reference: string;
  paymentUrl: string | null;
  manualOnly: boolean;
  wisePaymentId: string;
  amountCents: number;
  currency: string;
  iban: string | null;
  bic: string | null;
  beneficiaryName: string | null;
}> {
  if (args.currency !== "EUR") {
    throw new Error("Wise V1 aceita apenas EUR. Configure o preco em EUR para o serviço.");
  }
  const setting = await loadSetting();
  // Reuse existing payment for this order if pending
  const { data: existing } = await db
    .from("wise_payments")
    .select("*")
    .eq("order_id", args.orderId)
    .in("status", ["created", "waiting_payment", "pending_conciliation"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let reference: string;
  let wisePaymentId = "";
  let paymentUrl: string | null = null;
  let raw_request: Record<string, unknown> = {};
  let raw_response: Record<string, unknown> = {};

  if (existing) {
    reference = existing.external_reference as string;
    wisePaymentId = existing.id as string;
    paymentUrl = (existing.wise_payment_link_url as string | null) ?? null;
  } else {
    const refRpc = await db.rpc("wise_next_reference");
    reference =
      (refRpc?.data as string | null) ?? `EMP-${Math.floor(1000 + Math.random() * 9000)}`;
  }

  const token = tokenFromSettingOrEnv(setting);
  const profileId = setting.wise_profile_id;
  const balanceId = setting.wise_balance_id_eur;
  const manualOnlyMode = setting.wise_confirmation_mode === "manual_only";

  if (!existing && !manualOnlyMode && token && profileId) {
    const client: WiseClientOptions = { token, environment: setting.wise_environment };
    const description = (args.description ?? "Instituto Empuria").slice(0, 100);
    raw_request = {
      amount: args.amountCents / 100,
      currency: args.currency,
      reference: reference.slice(0, 35),
      description,
      balanceId,
    };
    const created = await createWisePaymentRequest(client, profileId, {
      amount: args.amountCents / 100,
      currency: args.currency,
      reference: reference.slice(0, 35),
      description,
      balanceId,
      metadata: { order_id: args.orderId, reference },
    });
    if (!created.ok) {
      console.error("[wise] payment-request failed", created.status, created.error);
      // Only persist as an "error" when there is no Quick Pay fallback configured.
      // Wise's public API does not expose Quick Pay creation, so a 404 here is expected.
      if (!setting.wise_default_payment_url) {
        raw_response = { error: created.error, status: created.status, body: created.body as unknown };
      } else {
        raw_response = { fallback: "quick_pay", api_status: created.status };
      }
    } else {
      raw_response = created.data as unknown as Record<string, unknown>;
      paymentUrl = pickHostedUrl(created.data);
    }
  }

  // Fallback to configured Quick Pay link. Append amount/currency so the
  // payer lands on the Wise page with the right value pre-filled. The
  // EMP-XXXX reference is shown on the order page for the payer to copy
  // into Wise's "reference / message" field.
  if (!paymentUrl && setting.wise_default_payment_url) {
    paymentUrl = appendQuickPayParams(setting.wise_default_payment_url, {
      amount: args.amountCents / 100,
      currency: args.currency,
    });
  }
  const manualOnly = !paymentUrl;

  if (!existing) {
    const { data: inserted, error } = await db
      .from("wise_payments")
      .insert({
        order_id: args.orderId,
        external_reference: reference,
        status: "waiting_payment",
        amount_cents: args.amountCents,
        currency: args.currency,
        description: args.description,
        wise_payment_link_id:
          (raw_response.id as string | undefined) ?? null,
        wise_payment_link_url: paymentUrl,
        raw_request,
        raw_response,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    wisePaymentId = inserted.id as string;
  }


  // Update order to wise/EUR
  await db
    .from("orders")
    .update({
      payment_provider: "wise",
      payment_amount_cents: args.amountCents,
      payment_currency: args.currency,
      payment_url: paymentUrl,
      payment_provider_reference: reference,
      external_reference: reference,
      payment_method: "wise",
    })
    .eq("id", args.orderId);

  return {
    reference,
    paymentUrl: paymentUrl ?? setting.wise_default_payment_url,
    manualOnly,
    wisePaymentId,
    amountCents: args.amountCents,
    currency: args.currency,
    iban: setting.wise_iban,
    bic: setting.wise_bic,
    beneficiaryName: setting.wise_beneficiary_name,
  };
}

/* Public read for /pagar/:token */
export const getPublicWisePayment = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(8).max(120) }).parse(d))
  .handler(async ({ data }) => {
    const { data: link } = await db
      .from("order_payment_links")
      .select("id,order_id,status,expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!link) throw new Error("Link nao encontrado.");
    if (link.status === "revoked") throw new Error("Link revogado.");
    if (new Date(link.expires_at).getTime() < Date.now()) throw new Error("Link expirado.");
    const { data: order } = await db
      .from("orders")
      .select(
        "id,customer_name,service_title,payment_amount_cents,payment_currency,payment_status,payment_url,payment_provider_reference,external_reference",
      )
      .eq("id", link.order_id)
      .maybeSingle();
    if (!order) throw new Error("Pedido nao encontrado.");

    const { data: payment } = await db
      .from("wise_payments")
      .select("status,amount_cents,currency,wise_payment_link_url,external_reference,paid_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const setting = await loadSetting();
    return {
      orderId: order.id as string,
      customerName: order.customer_name as string,
      serviceTitle: order.service_title as string,
      reference:
        (payment?.external_reference as string | undefined) ??
        (order.payment_provider_reference as string | undefined) ??
        (order.external_reference as string | undefined) ??
        `EMP-${order.id}`,
      amountCents:
        (payment?.amount_cents as number | undefined) ??
        (order.payment_amount_cents as number | undefined) ??
        0,
      currency:
        (payment?.currency as string | undefined) ??
        (order.payment_currency as string | undefined) ??
        "EUR",
      paymentUrl:
        (payment?.wise_payment_link_url as string | null | undefined) ??
        (order.payment_url as string | null | undefined) ??
        setting.wise_default_payment_url,
      paymentStatus: order.payment_status as string,
      iban: setting.wise_iban,
      bic: setting.wise_bic,
      beneficiaryName: setting.wise_beneficiary_name,
      enabled: setting.is_enabled,
    };
  });

/* Polling: re-fetch current status (refreshes wise link if api configured) */
export const refreshWisePaymentStatus = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { data: order } = await db
      .from("orders")
      .select("id,payment_status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido nao encontrado.");

    const { data: payment } = await db
      .from("wise_payments")
      .select("id,status,wise_payment_link_id")
      .eq("order_id", data.orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Optional: sync from Wise API
    if (payment?.wise_payment_link_id) {
      const setting = await loadSetting();
      const token = tokenFromSettingOrEnv(setting);
      if (token && setting.wise_profile_id) {
        const res = await getWisePaymentRequest(
          { token, environment: setting.wise_environment },
          setting.wise_profile_id,
          payment.wise_payment_link_id as string,
        );
        if (res.ok) {
          const status = String(res.data.status ?? "").toLowerCase();
          if (status === "paid" || status === "claimed" || status === "completed") {
            await db
              .from("wise_payments")
              .update({ status: "paid", paid_at: new Date().toISOString(), raw_webhook: res.data })
              .eq("id", payment.id);
            await db
              .from("orders")
              .update({ payment_status: "aprovado", paid_at: new Date().toISOString() })
              .eq("id", data.orderId);
          }
        }
      }
    }

    const { data: latest } = await db
      .from("orders")
      .select("payment_status")
      .eq("id", data.orderId)
      .maybeSingle();
    return {
      paymentStatus: (latest?.payment_status as string) ?? "pendente",
      wiseStatus: (payment?.status as string | undefined) ?? "waiting_payment",
    };
  });

/* Conciliation: list pending events, match, approve, ignore */

export const listWiseEvents = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({ matchStatus: z.string().optional(), limit: z.number().int().min(1).max(200).optional() })
      .parse(d),
  )
  .handler(async ({ data }) => {
    let q = db
      .from("wise_events")
      .select(
        "id,event_id,event_type,match_status,signature_valid,payload,matched_payment_id,matched_order_id,processed_at,notes,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 50);
    if (data.matchStatus) q = q.eq("match_status", data.matchStatus);
    const { data: rows } = await q;
    return { events: rows ?? [] };
  });

export const manuallyMatchWiseEvent = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        eventId: z.string().uuid(),
        orderId: z.string().uuid(),
        approve: z.boolean().default(true),
        notes: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: order } = await db.from("orders").select("id,payment_status").eq("id", data.orderId).maybeSingle();
    if (!order) throw new Error("Pedido nao encontrado.");
    const { data: payment } = await db
      .from("wise_payments")
      .select("id")
      .eq("order_id", data.orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await db
      .from("wise_events")
      .update({
        match_status: "manual_matched",
        matched_order_id: data.orderId,
        matched_payment_id: payment?.id ?? null,
        processed_at: new Date().toISOString(),
        notes: data.notes ?? null,
      })
      .eq("id", data.eventId);
    if (data.approve) {
      if (payment?.id) {
        await db
          .from("wise_payments")
          .update({ status: "paid", paid_at: new Date().toISOString() })
          .eq("id", payment.id);
      }
      await db
        .from("orders")
        .update({ payment_status: "aprovado", paid_at: new Date().toISOString() })
        .eq("id", data.orderId);
    }
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      module: "financeiro",
      entity_type: "wise_event",
      entity_id: data.eventId,
      action: "wise_event.manually_matched",
      new_data: { order_id: data.orderId, approve: data.approve, notes: data.notes ?? null },
    });
    return { ok: true };
  });

export const ignoreWiseEvent = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ eventId: z.string().uuid(), notes: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await db
      .from("wise_events")
      .update({
        match_status: "ignored",
        processed_at: new Date().toISOString(),
        notes: data.notes ?? null,
      })
      .eq("id", data.eventId);
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      module: "financeiro",
      entity_type: "wise_event",
      entity_id: data.eventId,
      action: "wise_event.ignored",
    });
    return { ok: true };
  });

export const manuallyApproveWisePayment = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({ orderId: z.string().uuid(), reason: z.string().trim().min(10).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: payment } = await db
      .from("wise_payments")
      .select("id")
      .eq("order_id", data.orderId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment?.id) {
      await db
        .from("wise_payments")
        .update({ status: "paid", paid_at: new Date().toISOString() })
        .eq("id", payment.id);
    }
    await db
      .from("orders")
      .update({ payment_status: "aprovado", paid_at: new Date().toISOString() })
      .eq("id", data.orderId);
    await db.from("audit_logs").insert({
      actor_id: context.userId,
      module: "financeiro",
      entity_type: "order",
      entity_id: data.orderId,
      action: "wise_payment.manually_approved",
      new_data: { reason: data.reason },
    });
    return { ok: true };
  });

/* Used by the authenticated checkout flow to mint a wise payment. */
export const createWiseCheckoutPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const userId = context.effectiveUserId ?? context.userId;
    const { data: order } = await db
      .from("orders")
      .select("id,user_id,service_title,payment_amount_cents,payment_currency,amount_cents,currency,customer_email")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido nao encontrado.");
    if (order.user_id !== userId) throw new Error("Acesso negado.");
    return createWisePaymentForOrder({
      orderId: order.id,
      amountCents: order.payment_amount_cents ?? order.amount_cents,
      currency: order.payment_currency ?? order.currency ?? "EUR",
      description: order.service_title,
      customerEmail: order.customer_email,
    });
  });
