import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scoreLead, TIMELINE_LABEL, BUDGET_LABEL, COUNTRY_LABEL, VISA_LABEL } from "./scoring";

const schema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(255),
  phone: z.string().trim().min(6).max(30),
  current_country: z.enum(["espanha", "brasil", "europa", "outro"]),
  target_visa: z.enum(["residencia", "cidadania", "relocation", "outros"]),
  timeline: z.enum(["ate_3m", "3_6m", "6_12m", "mais_12m"]),
  budget_range: z.enum(["ate_2k", "2_5k", "5_10k", "mais_10k"]),
  message: z.string().trim().max(1000).optional().nullable(),
});

export const submitConsultoriaLead = createServerFn({ method: "POST" })
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data }) => {
    const score = scoreLead(data.timeline, data.budget_range);
    const firstName = data.full_name.split(/\s+/)[0];
    // CRM columns are added by the companion migration; generated Supabase types lag until regeneration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const { data: row, error } = await db
      .from("leads")
      .insert({
        full_name: data.full_name,
        email: data.email.toLowerCase(),
        phone: data.phone,
        current_country: COUNTRY_LABEL[data.current_country] ?? data.current_country,
        target_visa: VISA_LABEL[data.target_visa] ?? data.target_visa,
        timeline: TIMELINE_LABEL[data.timeline] ?? data.timeline,
        budget_range: BUDGET_LABEL[data.budget_range] ?? data.budget_range,
        message: data.message || null,
        first_message: data.message || null,
        pipeline_stage: "novo",
        status: "novo",
        source: "site",
        source_detail: "consultoria_public_form",
        last_interaction_at: new Date().toISOString(),
        qualification_score: score,
        qualification_answers: {
          current_country: data.current_country,
          target_visa: data.target_visa,
          timeline: data.timeline,
          budget_range: data.budget_range,
        },
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);
    return { ok: true, leadId: row.id, firstName };
  });
