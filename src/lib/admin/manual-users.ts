import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { normalizePhone, getCountryFromPhone } from "@/lib/phone/phone.utils";

export type ManualUserOrigin = "admin_created" | "pdv" | "esteira" | "checkout" | "future_crm";

export type ManualCustomerResult = {
  user_id: string;
  email: string;
  full_name: string;
  phone: string | null;
  created: boolean;
  password_setup_required: boolean;
};

type AuthUser = {
  id: string;
  email?: string | null;
};

type ProfileAccessState = {
  id: string;
  created_by_admin: boolean | null;
  password_setup_required: boolean | null;
  first_access_completed_at: string | null;
  created_by_staff_id: string | null;
  profile_origin: string | null;
};
type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];

const emailEq = (a: string | null | undefined, b: string) => (a ?? "").toLowerCase() === b;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const normalized = normalizeEmail(email);
  const perPage = 200;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const match = data.users.find((user) => emailEq(user.email, normalized));
    if (match) return { id: match.id, email: match.email };
    if (data.users.length < perPage) break;
  }
  return null;
}

export async function createOrReuseManualCustomer(input: {
  fullName: string;
  email: string;
  phone: string | null;
  origin: ManualUserOrigin;
  actorId: string;
  isClubMember?: boolean;
  adminNotes?: string | null;
}): Promise<ManualCustomerResult> {
  const email = normalizeEmail(input.email);
  const rawPhone = input.phone?.trim() || null;
  const phone = rawPhone ? (normalizePhone(rawPhone) ?? rawPhone) : null;
  const phoneCountry = phone ? getCountryFromPhone(phone) : null;
  let user = await findAuthUserByEmail(email);
  let created = false;

  if (!user) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        full_name: input.fullName,
        phone,
        manual_origin: input.origin,
      },
    });
    if (error || !data.user) throw new Error(error?.message ?? "Nao foi possivel criar o usuario");
    user = { id: data.user.id, email: data.user.email };
    created = true;
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, full_name, phone, phone_country_iso, created_by_admin, password_setup_required, first_access_completed_at, created_by_staff_id, profile_origin",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);

  const current = profile as (ProfileAccessState & {
    full_name?: string | null;
    phone?: string | null;
    phone_country_iso?: string | null;
  }) | null;
  const shouldMarkManual = created || !current || current.created_by_admin === true;
  const passwordSetupRequired = shouldMarkManual
    ? created
      ? true
      : current?.first_access_completed_at
        ? false
        : (current?.password_setup_required ?? true)
    : false;

  // Preserve identity of existing profiles: only set name/phone when criando
  // um perfil novo. Reutilizar perfil existente nao deve renomear o cliente,
  // mesmo que a operadora tenha digitado outro nome no PDV — isso causava
  // sobrescrita retroativa do historico.
  const preserveExisting = !created && !!current;
  const effectiveFullName = preserveExisting
    ? (current?.full_name?.trim() ? current.full_name : input.fullName)
    : input.fullName;
  const effectivePhone = preserveExisting
    ? (current?.phone ?? phone)
    : phone;
  const effectivePhoneCountry = preserveExisting
    ? (current?.phone_country_iso ?? phoneCountry)
    : phoneCountry;

  const profilePatch: ProfileInsert = {
    id: user.id,
    full_name: effectiveFullName,
    phone: effectivePhone,
    phone_country_iso: effectivePhoneCountry,
    ...(input.isClubMember !== undefined ? { is_club_member: input.isClubMember } : {}),
    ...(input.adminNotes !== undefined ? { admin_notes: input.adminNotes || null } : {}),
    created_by_admin: shouldMarkManual,
    password_setup_required: passwordSetupRequired,
    first_access_completed_at: current?.first_access_completed_at ?? null,
    created_by_staff_id: shouldMarkManual ? (current?.created_by_staff_id ?? input.actorId) : null,
    profile_origin: shouldMarkManual
      ? created
        ? input.origin
        : (current?.profile_origin ?? input.origin)
      : (current?.profile_origin ?? "public_signup"),
  };

  const { error: upsertError } = await supabaseAdmin
    .from("profiles")
    .upsert(profilePatch, { onConflict: "id" });
  if (upsertError) throw new Error(upsertError.message);

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: user.id, role: "member" }, { onConflict: "user_id,role" });
  if (roleError) throw new Error(roleError.message);

  await supabaseAdmin.from("audit_logs").insert({
    actor_id: input.actorId,
    action: created ? "manual_user.created" : "manual_user.reused",
    module: input.origin === "pdv" ? "pdv" : input.origin === "esteira" ? "esteira" : "usuarios",
    entity_type: "profile",
    entity_id: user.id,
    new_data: {
      email,
      full_name: input.fullName,
      origin: input.origin,
      password_setup_required: passwordSetupRequired,
    },
  });

  return {
    user_id: user.id,
    email,
    full_name: effectiveFullName,
    phone: effectivePhone,
    created,
    password_setup_required: passwordSetupRequired,
  };
}
