import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { createOrReuseManualCustomer } from "./manual-users";
import { normalizePhone, getCountryFromPhone } from "@/lib/phone/phone.utils";

export type UserRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  email: string | null;
  is_blocked: boolean;
  admin_notes: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  created_by_admin: boolean;
  password_setup_required: boolean;
  first_access_completed_at: string | null;
  profile_origin: string | null;
  member_status: string;
  member_next_step: string | null;
  active_services: number;
  pending_documents: number;
};

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        search: z.string().trim().max(120).optional().default(""),
        status: z.enum(["todos", "ativos", "bloqueados"]).default("todos"),
        memberStatus: z
          .enum([
            "todos",
            "novo",
            "em_atendimento",
            "aguardando_documentos",
            "em_andamento",
            "aguardando_cliente",
            "concluido",
            "inativo",
          ])
          .default("todos"),
        period: z.enum(["todos", "7d", "mes"]).default("todos"),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(5).max(100).default(25),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    // Pull a generous slice of profiles (filtros aplicados em memória — base pequena/média).
    let q = supabaseAdmin
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (data.period === "7d") {
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      q = q.gte("created_at", since);
    } else if (data.period === "mes") {
      const d0 = new Date();
      d0.setDate(1);
      d0.setHours(0, 0, 0, 0);
      q = q.gte("created_at", d0.toISOString());
    }
    if (data.status === "ativos") q = q.eq("is_blocked", false);
    if (data.status === "bloqueados") q = q.eq("is_blocked", true);
    if (data.memberStatus !== "todos") q = q.eq("member_status", data.memberStatus);

    const { data: profiles, error } = await q;
    if (error) throw new Error(error.message);

    // Map emails + last_sign_in_at via auth.admin.listUsers (paginado).
    const emails = new Map<string, { email: string | null; last_sign_in_at: string | null }>();
    let page = 1;
    const perPage = 200;
    // até 5 páginas (1000 usuários) — suficiente nesta fase.
    for (let i = 0; i < 5; i++) {
      const { data: authPage, error: authErr } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage,
      });
      if (authErr) break;
      authPage.users.forEach((u) =>
        emails.set(u.id, { email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null }),
      );
      if (authPage.users.length < perPage) break;
      page++;
    }

    let rows: UserRow[] = (profiles ?? []).map((p) => {
      const meta = emails.get(p.id);
      return {
        id: p.id,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        phone: p.phone,
        email: meta?.email ?? null,
        is_blocked: p.is_blocked,
        admin_notes: p.admin_notes,
        created_at: p.created_at,
        last_sign_in_at: meta?.last_sign_in_at ?? null,
        created_by_admin: Boolean(p.created_by_admin),
        password_setup_required: Boolean(p.password_setup_required),
        first_access_completed_at: p.first_access_completed_at ?? null,
        profile_origin: p.profile_origin ?? null,
        member_status: p.member_status,
        member_next_step: p.member_next_step,
        active_services: 0,
        pending_documents: 0,
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      const idMatch = s.replace(/^emp-\d{4}-/i, "").replace(/-/g, "");
      rows = rows.filter(
        (r) =>
          (r.full_name ?? "").toLowerCase().includes(s) ||
          (r.email ?? "").toLowerCase().includes(s) ||
          r.id.toLowerCase().includes(s) ||
          r.id.replace(/-/g, "").toLowerCase().includes(idMatch),
      );
    }

    const total = rows.length;
    const inProgress = rows.filter(
      (r) => r.member_status === "em_atendimento" || r.member_status === "em_andamento",
    ).length;
    const awaitingDocuments = rows.filter(
      (r) => r.member_status === "aguardando_documentos",
    ).length;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const newThisMonth = rows.filter((r) => new Date(r.created_at) >= monthStart).length;

    const start = (data.page - 1) * data.pageSize;
    const items = rows.slice(start, start + data.pageSize);
    const ids = items.map((item) => item.id);
    if (ids.length) {
      const [ordersRes, docsRes] = await Promise.all([
        supabaseAdmin
          .from("orders")
          .select("user_id,payment_status,delivery_status")
          .in("user_id", ids),
        supabaseAdmin.from("member_documents").select("user_id,status").in("user_id", ids),
      ]);
      if (ordersRes.error) throw new Error(ordersRes.error.message);
      if (docsRes.error) throw new Error(docsRes.error.message);
      for (const item of items) {
        item.active_services = (ordersRes.data ?? []).filter(
          (order) =>
            order.user_id === item.id &&
            order.payment_status === "aprovado" &&
            order.delivery_status !== "concluido",
        ).length;
        item.pending_documents = (docsRes.data ?? []).filter(
          (doc) =>
            doc.user_id === item.id &&
            (doc.status === "requested" || doc.status === "needs_replacement"),
        ).length;
      }
    }

    return {
      items,
      total,
      inProgress,
      awaitingDocuments,
      newThisMonth,
      page: data.page,
      pageSize: data.pageSize,
    };
  });

export const createManualUser = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        full_name: z.string().trim().min(2).max(160),
        email: z.string().trim().email().max(255),
        phone: z.string().trim().min(5).max(40),
        admin_notes: z.string().trim().max(2000).optional().or(z.literal("")),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const customer = await createOrReuseManualCustomer({
      fullName: data.full_name,
      email: data.email,
      phone: data.phone,
      origin: "admin_created",
      actorId: context.userId,
      adminNotes: data.admin_notes || null,
    });
    return customer;
  });

export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        full_name: z.string().trim().min(1).max(160).optional(),
        phone: z.string().trim().max(40).optional().nullable(),
        admin_notes: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { id, phone, ...rest } = data;
    const patch: Database["public"]["Tables"]["profiles"]["Update"] = { ...rest };
    if (phone !== undefined) {
      const norm = phone ? (normalizePhone(phone) ?? phone) : null;
      patch.phone = norm;
      patch.phone_country_iso = norm ? getCountryFromPhone(norm) : null;
    }
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setUserBlocked = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ id: z.string().uuid(), blocked: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ is_blocked: data.blocked })
      .eq("id", data.id);
    if (pErr) throw new Error(pErr.message);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      ban_duration: data.blocked ? "876000h" : "none",
    });
    if (aErr) throw new Error(aErr.message);
    return { ok: true };
  });

export const forcePasswordReset = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        redirect_to: z.string().url().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.id)
      .maybeSingle();
    if (!prof) throw new Error("Usuário não encontrado");
    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.id);
    const email = authUser.user?.email;
    if (!email) throw new Error("Usuário sem e-mail");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: data.redirect_to ? { redirectTo: data.redirect_to } : undefined,
    });
    if (error) throw new Error(error.message);
    return { url: link.properties?.action_link ?? "" };
  });

export const changeUserEmail = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({ id: z.string().uuid(), new_email: z.string().email().max(255) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.id, {
      email: data.new_email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const impersonateUser = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        id: z.string().uuid(),
        reason: z.string().trim().min(10).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name")
      .eq("id", data.id)
      .maybeSingle();
    if (profileError || !profile) throw new Error("Usuário não encontrado");
    await supabaseAdmin.from("impersonation_logs").insert({
      admin_id: context.userId,
      target_user_id: data.id,
      reason: data.reason,
    });
    return { targetUserId: profile.id, targetName: profile.full_name };
  });
