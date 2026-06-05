/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireAdmin } from "@/lib/admin/auth";
import {
  normalizePhone,
  getCountryFromPhone,
  isValidPhone,
} from "@/lib/phone/phone.utils";

export type PhoneCandidate = {
  table: "profiles" | "leads" | "crm_conversations" | "crm_inbox_messages" | "club_subscriptions";
  id: string;
  label: string | null;
  current: string;
  suggested: string | null;
  country: string | null;
  status: "ok" | "needs_review" | "invalid";
  reason: string | null;
};

const db = supabaseAdmin as unknown as { from: (t: string) => any };

function evaluate(raw: string | null | undefined): {
  suggested: string | null;
  country: string | null;
  status: PhoneCandidate["status"];
  reason: string | null;
} {
  if (!raw || !raw.trim()) {
    return { suggested: null, country: null, status: "invalid", reason: "Vazio" };
  }
  const direct = normalizePhone(raw);
  if (direct && isValidPhone(direct)) {
    if (direct === raw) {
      return { suggested: direct, country: getCountryFromPhone(direct), status: "ok", reason: "Ja em E.164" };
    }
    return { suggested: direct, country: getCountryFromPhone(direct), status: "ok", reason: "Detectado por DDI" };
  }
  const br = normalizePhone(raw, "BR");
  if (br && isValidPhone(br)) {
    return {
      suggested: br,
      country: "BR",
      status: "needs_review",
      reason: "Inferido como Brasil (sem DDI)",
    };
  }
  return { suggested: null, country: null, status: "invalid", reason: "Nao foi possivel normalizar" };
}

export const listPhoneMigrationCandidates = createServerFn({ method: "GET" })
  .middleware([requireAdmin()])
  .handler(async (): Promise<{ candidates: PhoneCandidate[]; counts: Record<string, number> }> => {
    const [profiles, leads, conversations, inbox, subs] = await Promise.all([
      db.from("profiles").select("id, full_name, phone").not("phone", "is", null).limit(2000),
      db.from("leads").select("id, full_name, phone").not("phone", "is", null).limit(2000),
      db.from("crm_conversations").select("id, lead_id, phone").not("phone", "is", null).limit(2000),
      db
        .from("crm_inbox_messages")
        .select("id, from_name, from_phone")
        .not("from_phone", "is", null)
        .limit(2000),
      db
        .from("club_subscriptions")
        .select("id, buyer_email, buyer_phone")
        .not("buyer_phone", "is", null)
        .limit(2000),
    ]);

    const out: PhoneCandidate[] = [];

    for (const row of (profiles.data ?? []) as Array<{ id: string; full_name: string | null; phone: string }>) {
      const ev = evaluate(row.phone);
      out.push({ table: "profiles", id: row.id, label: row.full_name, current: row.phone, ...ev });
    }
    for (const row of (leads.data ?? []) as Array<{ id: string; full_name: string | null; phone: string }>) {
      const ev = evaluate(row.phone);
      out.push({ table: "leads", id: row.id, label: row.full_name, current: row.phone, ...ev });
    }
    for (const row of (conversations.data ?? []) as Array<{ id: string; phone: string }>) {
      const ev = evaluate(row.phone);
      out.push({ table: "crm_conversations", id: row.id, label: null, current: row.phone, ...ev });
    }
    for (const row of (inbox.data ?? []) as Array<{ id: string; from_name: string | null; from_phone: string }>) {
      const ev = evaluate(row.from_phone);
      out.push({ table: "crm_inbox_messages", id: row.id, label: row.from_name, current: row.from_phone, ...ev });
    }
    for (const row of (subs.data ?? []) as Array<{ id: string; buyer_email: string | null; buyer_phone: string }>) {
      const ev = evaluate(row.buyer_phone);
      out.push({ table: "club_subscriptions", id: row.id, label: row.buyer_email, current: row.buyer_phone, ...ev });
    }

    // Only show rows that would actually change or have problems.
    const filtered = out.filter((c) => c.reason !== "Ja em E.164");
    const counts = filtered.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {});
    return { candidates: filtered, counts };
  });

const COLUMN_BY_TABLE: Record<PhoneCandidate["table"], { phoneCol: string; isoCol: string | null }> = {
  profiles: { phoneCol: "phone", isoCol: "phone_country_iso" },
  leads: { phoneCol: "phone", isoCol: "phone_country_iso" },
  crm_conversations: { phoneCol: "phone", isoCol: null },
  crm_inbox_messages: { phoneCol: "from_phone", isoCol: null },
  club_subscriptions: { phoneCol: "buyer_phone", isoCol: null },
};

export const applyPhoneMigration = createServerFn({ method: "POST" })
  .middleware([requireAdmin()])
  .inputValidator((d) =>
    z
      .object({
        items: z
          .array(
            z.object({
              table: z.enum([
                "profiles",
                "leads",
                "crm_conversations",
                "crm_inbox_messages",
                "club_subscriptions",
              ]),
              id: z.string().min(1),
              e164: z.string().min(8).max(20),
              country: z.string().min(2).max(8).optional().nullable(),
            }),
          )
          .min(1)
          .max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    let updated = 0;
    const errors: Array<{ id: string; error: string }> = [];
    for (const item of data.items) {
      if (!isValidPhone(item.e164)) {
        errors.push({ id: item.id, error: "Telefone sugerido invalido" });
        continue;
      }
      const cols = COLUMN_BY_TABLE[item.table];
      const patch: Record<string, unknown> = { [cols.phoneCol]: item.e164 };
      if (cols.isoCol) patch[cols.isoCol] = item.country ?? getCountryFromPhone(item.e164);
      const { error } = await db.from(item.table).update(patch).eq("id", item.id);
      if (error) {
        errors.push({ id: item.id, error: error.message });
        continue;
      }
      updated += 1;
    }
    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "phone_migration.apply",
      module: "configuracoes",
      entity_type: "bulk",
      new_data: { count: data.items.length, updated, errors } as any,
    });
    return { ok: true, updated, errors };
  });
