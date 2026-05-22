import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listPublicServices = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await supabaseAdmin
    .from("services")
    .select(
      "id,slug,title,short_description,description,kind,price_cents,currency,requires_slot,requires_documents,meeting_address,image_url",
    )
    .eq("is_active", true)
    .eq("category", "esteira1")
    .order("price_cents", { ascending: true });
  return data ?? [];
});

export const getPublicService = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slug: z.string().min(2).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { data: svc } = await supabaseAdmin
      .from("services")
      .select(
        "id,slug,title,short_description,description,kind,price_cents,currency,requires_slot,requires_documents,document_checklist,meeting_address,image_url",
      )
      .eq("slug", data.slug)
      .eq("is_active", true)
      .single();
    return svc;
  });
