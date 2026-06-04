import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { normalizePhone, getCountryFromPhone } from "@/lib/phone/phone.utils";

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([requireStaff])
  .handler(async ({ context }) => {
    const [{ data: profile }, { data: authUser }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, phone, avatar_url").eq("id", context.userId).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(context.userId),
    ]);
    return {
      profile: profile ?? null,
      email: authUser.user?.email ?? null,
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z.object({
      full_name: z.string().trim().min(1).max(160),
      phone: z.string().trim().max(40).nullable().optional(),
      avatar_url: z.string().url().max(500).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const rawPhone = data.phone?.trim() || null;
    const phone = rawPhone ? (normalizePhone(rawPhone) ?? rawPhone) : null;
    const phoneCountry = phone ? getCountryFromPhone(phone) : null;
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        full_name: data.full_name,
        phone,
        phone_country_iso: phoneCountry,
        avatar_url: data.avatar_url ?? null,
      })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "account.profile_updated",
      module: "configuracoes",
      entity_type: "profile",
      entity_id: context.userId,
      new_data: { full_name: data.full_name, phone: data.phone ?? null },
    });
    return { ok: true };
  });

export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ new_email: z.string().email().max(255) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      email: data.new_email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "account.email_changed",
      module: "configuracoes",
      entity_type: "auth.user",
      entity_id: context.userId,
      new_data: { email: data.new_email },
    });
    return { ok: true };
  });

export const updateMyPassword = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => z.object({ new_password: z.string().min(8).max(72) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.new_password,
    });
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "account.password_changed",
      module: "configuracoes",
      entity_type: "auth.user",
      entity_id: context.userId,
    });
    return { ok: true };
  });
