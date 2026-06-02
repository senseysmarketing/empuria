import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { findAuthUserByEmail, normalizeEmail } from "@/lib/admin/manual-users";

type FirstAccessProfile = {
  id: string;
  created_by_admin: boolean | null;
  password_setup_required: boolean | null;
  first_access_completed_at: string | null;
  full_name: string | null;
};

const emailSchema = z.object({
  email: z.string().trim().email().max(255),
});

const completeSchema = emailSchema.extend({
  password: z.string().min(8).max(72),
});

async function getEligibleManualProfile(email: string) {
  const user = await findAuthUserByEmail(email);
  if (!user) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, created_by_admin, password_setup_required, first_access_completed_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const profile = data as FirstAccessProfile | null;
  if (
    !profile ||
    profile.created_by_admin !== true ||
    profile.password_setup_required !== true ||
    profile.first_access_completed_at
  ) {
    return null;
  }

  return { user, profile };
}

export const checkFirstAccessEligibility = createServerFn({ method: "POST" })
  .inputValidator((d) => emailSchema.parse(d))
  .handler(async ({ data }) => {
    const eligible = await getEligibleManualProfile(normalizeEmail(data.email));
    return { eligible: Boolean(eligible) };
  });

export const completeFirstAccess = createServerFn({ method: "POST" })
  .inputValidator((d) => completeSchema.parse(d))
  .handler(async ({ data }) => {
    const email = normalizeEmail(data.email);
    const eligible = await getEligibleManualProfile(email);
    if (!eligible) {
      throw new Error("Nao encontramos uma conta disponivel para primeiro acesso com este e-mail.");
    }

    const { user, profile } = eligible;
    const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: data.password,
      email_confirm: true,
    });
    if (authError) throw new Error(authError.message);

    const now = new Date().toISOString();
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({
        password_setup_required: false,
        first_access_completed_at: now,
      })
      .eq("id", user.id)
      .eq("password_setup_required", true)
      .is("first_access_completed_at", null);
    if (profileError) throw new Error(profileError.message);

    await supabaseAdmin.from("audit_logs").insert({
      actor_id: null,
      action: "first_access.completed",
      module: "auth",
      entity_type: "profile",
      entity_id: user.id,
      new_data: { email, completed_at: now },
    });

    return { ok: true, email };
  });
