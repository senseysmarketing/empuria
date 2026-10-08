import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "./auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MEMBER_STATUS = [
  "novo",
  "em_atendimento",
  "aguardando_documentos",
  "em_andamento",
  "aguardando_cliente",
  "concluido",
  "inativo",
] as const;

const memberIdSchema = z.object({ userId: z.string().uuid() });

export const getMemberDossier = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => memberIdSchema.parse(d))
  .handler(async ({ data }) => {
    const [profileRes, ordersRes, documentsRes, appointmentsRes, authRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select(
          "id,full_name,phone,avatar_url,created_at,is_blocked,admin_notes,member_status,member_next_step,member_status_updated_at,password_setup_required,first_access_completed_at",
        )
        .eq("id", data.userId)
        .maybeSingle(),
      supabaseAdmin
        .from("orders")
        .select(
          "id,service_id,service_title,created_at,payment_status,delivery_status,amount_cents,currency,paid_at",
        )
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("member_documents")
        .select(
          "id,user_id,order_id,title,category,status,visible_to_member,file_name,mime_type,file_size_bytes,member_message,admin_notes,uploaded_at,created_at,updated_at",
        )
        .eq("user_id", data.userId)
        .order("updated_at", { ascending: false }),
      supabaseAdmin
        .from("appointments")
        .select("id,service_id,starts_at,ends_at,status,services(title)")
        .eq("user_id", data.userId)
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(5),
      supabaseAdmin.auth.admin.getUserById(data.userId),
    ]);
    if (profileRes.error) throw new Error(profileRes.error.message);
    if (!profileRes.data) throw new Error("Membro não encontrado");
    if (authRes.error) throw new Error(authRes.error.message);
    for (const res of [ordersRes, documentsRes, appointmentsRes]) {
      if (res.error) throw new Error(res.error.message);
    }
    return {
      profile: profileRes.data,
      email: authRes.data.user?.email ?? null,
      lastSignInAt: authRes.data.user?.last_sign_in_at ?? null,
      orders: ordersRes.data ?? [],
      documents: documentsRes.data ?? [],
      appointments: appointmentsRes.data ?? [],
    };
  });

export const updateMemberStatus = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    memberIdSchema
      .extend({
        status: z.enum(MEMBER_STATUS),
        nextStep: z.string().trim().max(2000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: before, error: readError } = await supabaseAdmin
      .from("profiles")
      .select("id,member_status,member_next_step")
      .eq("id", data.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!before) throw new Error("Membro não encontrado");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        member_status: data.status,
        member_next_step: data.nextStep,
        member_status_updated_at: new Date().toISOString(),
        member_status_updated_by: context.userId,
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      actor_id: context.userId,
      action: "member.status.updated",
      module: "usuarios",
      entity_type: "profile",
      entity_id: data.userId,
      old_data: { member_status: before.member_status, member_next_step: before.member_next_step },
      new_data: { member_status: data.status, member_next_step: data.nextStep },
    });
    if (auditError) throw new Error(auditError.message);
    return { ok: true };
  });
