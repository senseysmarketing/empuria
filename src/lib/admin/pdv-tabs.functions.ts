import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireModule } from "./auth";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { withPdvLog } from "./pdv-activity-log.server";


export type PdvTabStatus = "aberta" | "fechada" | "cancelada" | "aguardando_pagamento";
export type PdvTabPaymentMethod = "dinheiro" | "transferencia" | "wise";

export type PdvTabRecord = {
  id: string;
  tab_code: string;
  customer_id: string;
  opened_by: string;
  closed_by: string | null;
  cancelled_by: string | null;
  sale_id: string | null;
  status: PdvTabStatus;
  notes: string | null;
  subtotal_eur_cents: number;
  subtotal_brl_cents: number;
  discount_type: "none" | "amount" | "percent";
  discount_value: number;
  discount_eur_cents: number;
  discount_brl_cents: number;
  total_eur_cents: number;
  total_brl_cents: number;
  opened_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PdvTabItemRecord = {
  id: string;
  tab_id: string;
  product_id: string | null;
  product_name_snapshot: string;
  product_emoji_snapshot: string | null;
  qty: number;
  unit_price_eur_cents: number;
  unit_price_brl_cents: number;
  total_eur_cents: number;
  total_brl_cents: number;
  added_by: string;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type PdvTabProfile = {
  id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
};

export type PdvTabWithRelations = PdvTabRecord & {
  customer: PdvTabProfile | null;
  opened_by_profile: PdvTabProfile | null;
  items: Array<PdvTabItemRecord & { added_by_profile: PdvTabProfile | null }>;
};

type DbError = { message: string } | null;
type DbResult<T> = Promise<{ data: T | null; error: DbError }>;
type QueryBuilder<T> = {
  select: (columns: string) => QueryBuilder<T>;
  eq: (column: string, value: unknown) => QueryBuilder<T>;
  in: (column: string, values: unknown[]) => QueryBuilder<T>;
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T> & DbResult<T>;
};
type UntypedSupabase = {
  from: <T>(table: string) => QueryBuilder<T>;
  rpc: <T>(fn: string, args: Record<string, unknown>) => DbResult<T>;
};

const pdvDb = supabaseAdmin as unknown as UntypedSupabase;

const openSchema = z.object({
  customerId: z.string().uuid(),
  notes: z.string().trim().max(500).optional(),
});

const customerTabsSchema = z.object({
  customerId: z.string().uuid(),
});

const addItemSchema = z.object({
  tabId: z.string().uuid(),
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(99).default(1),
});

const updateQtySchema = z.object({
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(99),
});

const cancelItemSchema = z.object({
  itemId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

const closeSchema = z.object({
  tabId: z.string().uuid(),
  discount: z.object({
    type: z.enum(["none", "amount", "percent"]),
    value: z.number().min(0).max(100000),
  }),
  paymentMethod: z.enum(["dinheiro", "transferencia"]),
  notes: z.string().trim().max(500).optional(),
});

const cancelTabSchema = z.object({
  tabId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

async function getProfilesByIds(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, PdvTabProfile>();
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, phone, avatar_url")
    .in("id", unique);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((profile) => [profile.id, profile as PdvTabProfile]));
}

async function hydratePdvTabs(tabs: PdvTabRecord[], context: { isAdmin: boolean; userId: string }) {
  const tabIds = tabs.map((tab) => tab.id);

  const { data: itemsRaw, error: itemsError } = tabIds.length
    ? await pdvDb
        .from<PdvTabItemRecord[]>("pdv_tab_items")
        .select("*")
        .in("tab_id", tabIds)
        .order("created_at", { ascending: true })
    : { data: [], error: null };
  if (itemsError) throw new Error(itemsError.message);

  const items = (itemsRaw ?? []) as PdvTabItemRecord[];
  const profileIds = tabs
    .flatMap((tab) => [tab.customer_id, tab.opened_by])
    .concat(items.map((item) => item.added_by));
  const profiles = await getProfilesByIds(profileIds);

  const itemsByTab = new Map<
    string,
    Array<PdvTabItemRecord & { added_by_profile: PdvTabProfile | null }>
  >();
  for (const item of items) {
    const bucket = itemsByTab.get(item.tab_id) ?? [];
    bucket.push({ ...item, added_by_profile: profiles.get(item.added_by) ?? null });
    itemsByTab.set(item.tab_id, bucket);
  }

  return {
    tabs: tabs.map((tab) => ({
      ...tab,
      customer: profiles.get(tab.customer_id) ?? null,
      opened_by_profile: profiles.get(tab.opened_by) ?? null,
      items: itemsByTab.get(tab.id) ?? [],
    })),
    permissions: {
      canOpenTabs: true,
      canAddItems: true,
      canUpdateItemQty: true,
      canCloseTabs: true,
      canRemoveItem: true,
      canCancelTab: true,
      canCancelEmptyTab: true,
    },
  };
}

export const listPdvTabsWorkspace = createServerFn({ method: "GET" })
  .middleware([requireModule("pdv")])
  .handler(async ({ context }) => {
    const { data: tabsRaw, error: tabsError } = await pdvDb
      .from<PdvTabRecord[]>("pdv_tabs")
      .select("*")
      .eq("status", "aberta")
      .order("opened_at", { ascending: false });
    if (tabsError) throw new Error(tabsError.message);

    const tabs = (tabsRaw ?? []) as PdvTabRecord[];
    return hydratePdvTabs(tabs, context);
  });

export const listOpenPdvTabsForCustomer = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => customerTabsSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: tabsRaw, error: tabsError } = await pdvDb
      .from<PdvTabRecord[]>("pdv_tabs")
      .select("*")
      .eq("customer_id", data.customerId)
      .eq("status", "aberta")
      .order("opened_at", { ascending: false });
    if (tabsError) throw new Error(tabsError.message);

    return hydratePdvTabs((tabsRaw ?? []) as PdvTabRecord[], context);
  });

export const openPdvTab = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => openSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await pdvDb.rpc<{
      tab_id: string;
      tab_code: string;
      existing: boolean;
    }>("pdv_open_tab", {
      p_customer_id: data.customerId,
      p_opened_by: context.userId,
      p_notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    if (!result) throw new Error("Comanda nao retornada pelo banco.");
    return result;
  });

export const addPdvTabItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => addItemSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: itemId, error } = await pdvDb.rpc<string>("pdv_add_tab_item", {
      p_tab_id: data.tabId,
      p_product_id: data.productId,
      p_qty: data.qty,
      p_actor_id: context.userId,
    });
    if (error) throw new Error(error.message);
    if (!itemId) throw new Error("Item de comanda nao retornado pelo banco.");
    return { itemId };
  });

export const updatePdvTabItemQty = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => updateQtySchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await pdvDb.rpc<null>("pdv_update_tab_item_qty", {
      p_item_id: data.itemId,
      p_qty: data.qty,
      p_actor_id: context.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const cancelPdvTabItem = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => cancelItemSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await pdvDb.rpc<null>("pdv_cancel_tab_item", {
      p_item_id: data.itemId,
      p_actor_id: context.userId,
      p_reason: data.reason && data.reason.length >= 3 ? data.reason : "Removido pelo operador",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const closePdvTab = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => closeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { data: saleId, error } = await pdvDb.rpc<string>("pdv_close_tab", {
      p_tab_id: data.tabId,
      p_cashier_id: context.userId,
      p_discount_type: data.discount.type,
      p_discount_value: data.discount.value,
      p_payment_method: data.paymentMethod,
      p_notes: data.notes ?? null,
    });
    if (error) throw new Error(error.message);
    if (!saleId) throw new Error("Venda de comanda nao retornada pelo banco.");
    return { saleId };
  });

export const cancelPdvTab = createServerFn({ method: "POST" })
  .middleware([requireModule("pdv")])
  .inputValidator((data) => cancelTabSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await pdvDb.rpc<null>("pdv_cancel_tab", {
      p_tab_id: data.tabId,
      p_actor_id: context.userId,
      p_reason: data.reason && data.reason.length >= 3 ? data.reason : "Comanda cancelada pelo operador",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
