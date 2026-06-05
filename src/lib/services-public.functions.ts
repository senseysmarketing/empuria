import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PublicServiceRow = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description: string | null;
  kind: string | null;
  price_cents: number;
  currency: string;
  online_price_cents: number | null;
  online_currency: string | null;
  display_price_note: string | null;
  requires_slot: boolean;
  requires_documents: boolean;
  document_checklist?: string[] | null;
  meeting_address: string | null;
  image_url: string | null;
  is_active?: boolean;
};

const db = supabaseAdmin as unknown as {
  // Generated Supabase types are refreshed outside this feature branch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any;
};

export const listPublicServices = createServerFn({ method: "GET" }).handler(async () => {
  const { data } = await db
    .from("services")
    .select(
      "id,slug,title,short_description,description,kind,price_cents,currency,online_price_cents,online_currency,display_price_note,requires_slot,requires_documents,meeting_address,image_url",
    )
    .eq("is_active", true)
    .eq("category", "esteira1")
    .order("price_cents", { ascending: true });
  return (data ?? []) as PublicServiceRow[];
});

export const getPublicService = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ slug: z.string().min(2).max(80) }).parse(d))
  .handler(async ({ data }) => {
    const { data: svc } = await db
      .from("services")
      .select(
        "id,slug,title,short_description,description,kind,price_cents,currency,online_price_cents,online_currency,display_price_note,requires_slot,requires_documents,document_checklist,meeting_address,image_url,is_active",
      )
      .eq("slug", data.slug)
      .maybeSingle();
    return (svc ?? null) as PublicServiceRow | null;
  });
