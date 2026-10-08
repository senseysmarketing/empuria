import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireStaff } from "@/lib/admin/auth";
import { getUserStaffAccess } from "@/lib/admin/permission-checks";
import type { Database } from "@/integrations/supabase/types";
import {
  MEMBER_DOCUMENT_MAX_BYTES,
  MEMBER_DOCUMENT_MIME_TYPES,
  memberCanSeeDocument,
  memberCanUploadDocument,
  validateMemberFile,
  isMemberDocumentPath,
} from "./member-documents.security";

const BUCKET = "member-documents";
type MemberDocument = Database["public"]["Tables"]["member_documents"]["Row"];

const documentIdSchema = z.object({ documentId: z.string().uuid() });
const fileSchema = documentIdSchema.extend({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim(),
  fileSizeBytes: z.number().int().positive().max(MEMBER_DOCUMENT_MAX_BYTES),
});

async function getDocument(id: string) {
  const { data, error } = await supabaseAdmin
    .from("member_documents")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Documento não encontrado");
  return data;
}

export async function assertMemberOrder(userId: string, orderId: string | null | undefined) {
  if (!orderId) return;
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Serviço não pertence a este membro");
}

async function audit(
  actorId: string,
  action: string,
  documentId: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
) {
  const { error } = await supabaseAdmin.from("audit_logs").insert({
    actor_id: actorId,
    action,
    module: "usuarios",
    entity_type: "member_document",
    entity_id: documentId,
    old_data: oldData as Database["public"]["Tables"]["audit_logs"]["Insert"]["old_data"],
    new_data: newData as Database["public"]["Tables"]["audit_logs"]["Insert"]["new_data"],
  });
  if (error) throw new Error(error.message);
}

export const listMyMemberDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const userId = context.effectiveUserId ?? context.userId;
    const { data, error } = await supabaseAdmin
      .from("member_documents")
      .select(
        "id,order_id,title,category,status,visible_to_member,file_name,mime_type,file_size_bytes,member_message,uploaded_at,created_at,updated_at",
      )
      .eq("user_id", userId)
      .eq("visible_to_member", true)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const requestMemberDocument = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        orderId: z.string().uuid().nullable().optional(),
        title: z.string().trim().min(1).max(200),
        category: z.string().trim().max(100).nullable().optional(),
        visibleToMember: z.boolean().default(true),
        memberMessage: z.string().trim().max(2000).nullable().optional(),
        adminNotes: z.string().trim().max(2000).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: member } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", data.userId)
      .maybeSingle();
    if (!member) throw new Error("Membro não encontrado");
    await assertMemberOrder(data.userId, data.orderId);
    const { data: doc, error } = await supabaseAdmin
      .from("member_documents")
      .insert({
        user_id: data.userId,
        order_id: data.orderId ?? null,
        title: data.title,
        category: data.category ?? null,
        visible_to_member: data.visibleToMember,
        member_message: data.memberMessage ?? null,
        admin_notes: data.adminNotes ?? null,
        requested_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await audit(context.userId, "member.document.requested", doc.id, null, {
      user_id: data.userId,
      order_id: data.orderId ?? null,
      title: data.title,
      visible_to_member: data.visibleToMember,
    });
    return { id: doc.id };
  });

export const updateMemberDocument = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    z
      .object({
        documentId: z.string().uuid(),
        title: z.string().trim().min(1).max(200),
        category: z.string().trim().max(100).nullable(),
        orderId: z.string().uuid().nullable(),
        visibleToMember: z.boolean(),
        memberMessage: z.string().trim().max(2000).nullable(),
        adminNotes: z.string().trim().max(2000).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    await assertMemberOrder(doc.user_id, data.orderId);
    const { error } = await supabaseAdmin
      .from("member_documents")
      .update({
        title: data.title,
        category: data.category,
        order_id: data.orderId,
        visible_to_member: data.visibleToMember,
        member_message: data.memberMessage,
        admin_notes: data.adminNotes,
      })
      .eq("id", doc.id);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      "member.document.updated",
      doc.id,
      { title: doc.title, order_id: doc.order_id, visible_to_member: doc.visible_to_member },
      { title: data.title, order_id: data.orderId, visible_to_member: data.visibleToMember },
    );
    return { ok: true };
  });

export const reviewMemberDocument = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) =>
    documentIdSchema
      .extend({
        status: z.enum(["approved", "needs_replacement"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    if (data.status === "approved" && !doc.storage_path) {
      throw new Error("Envie o arquivo antes de aprovar");
    }
    const { error } = await supabaseAdmin
      .from("member_documents")
      .update({
        status: data.status,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", doc.id);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      "member.document.reviewed",
      doc.id,
      { status: doc.status },
      { status: data.status },
    );
    return { ok: true };
  });

async function allowedUpload(
  doc: MemberDocument,
  actorId: string,
  effectiveUserId: string,
  impersonating: boolean,
) {
  const staff = !impersonating && (await getUserStaffAccess(actorId)).canAccessAdmin;
  if (!staff && !memberCanUploadDocument(doc, effectiveUserId)) {
    throw new Error("Envio não permitido para este documento");
  }
  return staff;
}

export const prepareMemberDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => fileSchema.parse(d))
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    await allowedUpload(
      doc,
      context.userId,
      context.effectiveUserId ?? context.userId,
      Boolean(context.impersonation),
    );
    const safeName = validateMemberFile(data);
    const path = `${doc.user_id}/${doc.id}/${crypto.randomUUID()}-${safeName}`;
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Falha ao preparar envio");
    return { path, token: signed.token };
  });

export const finalizeMemberDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => fileSchema.extend({ path: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    await allowedUpload(
      doc,
      context.userId,
      context.effectiveUserId ?? context.userId,
      Boolean(context.impersonation),
    );
    const safeName = validateMemberFile(data);
    const prefix = `${doc.user_id}/${doc.id}/`;
    const name = data.path.slice(prefix.length);
    if (!isMemberDocumentPath(data.path, doc.user_id, doc.id, safeName)) {
      throw new Error("Caminho de arquivo inválido");
    }
    const { data: objects, error: listError } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(prefix.slice(0, -1), { limit: 100 });
    if (listError) throw new Error(listError.message);
    const object = objects?.find((item) => item.name === name);
    if (!object) throw new Error("Arquivo ainda não foi recebido");
    const actualSize = Number(object.metadata?.size ?? 0);
    const actualMime = String(object.metadata?.mimetype ?? "");
    if (
      !actualSize ||
      actualSize > MEMBER_DOCUMENT_MAX_BYTES ||
      actualSize !== data.fileSizeBytes ||
      actualMime !== data.mimeType ||
      !MEMBER_DOCUMENT_MIME_TYPES.has(actualMime)
    ) {
      await supabaseAdmin.storage.from(BUCKET).remove([data.path]);
      throw new Error("Arquivo recebido não corresponde ao tipo/tamanho autorizado");
    }
    const patch = {
      storage_path: data.path,
      file_name: data.fileName,
      mime_type: actualMime,
      file_size_bytes: actualSize,
      uploaded_by: context.userId,
      uploaded_at: new Date().toISOString(),
      status: "received" as const,
      reviewed_by: null,
      reviewed_at: null,
    };
    const { data: updated, error } = await supabaseAdmin
      .from("member_documents")
      .update(patch)
      .eq("id", doc.id)
      .eq("updated_at", doc.updated_at)
      .select("id")
      .maybeSingle();
    if (error || !updated) {
      await supabaseAdmin.storage.from(BUCKET).remove([data.path]);
      throw new Error(error?.message ?? "Documento mudou durante o envio; tente novamente");
    }
    await audit(
      context.userId,
      "member.document.uploaded",
      doc.id,
      { had_file: Boolean(doc.storage_path), status: doc.status },
      { file_name: data.fileName, file_size_bytes: actualSize, status: "received" },
    );
    if (doc.storage_path && doc.storage_path !== data.path) {
      const { error: removeError } = await supabaseAdmin.storage
        .from(BUCKET)
        .remove([doc.storage_path]);
      if (removeError)
        console.error("[member-documents] old file cleanup failed", {
          documentId: doc.id,
          message: removeError.message,
        });
    }
    return { ok: true };
  });

export const getMemberDocumentDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => documentIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    const staff =
      !context.impersonation && (await getUserStaffAccess(context.userId)).canAccessAdmin;
    if (!staff && !memberCanSeeDocument(doc, context.effectiveUserId ?? context.userId)) {
      throw new Error("Acesso negado");
    }
    if (!doc.storage_path) throw new Error("Documento sem arquivo");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name ?? true });
    if (error || !signed) throw new Error(error?.message ?? "Falha ao gerar download");
    return { url: signed.signedUrl };
  });

export const deleteMemberDocument = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((d) => documentIdSchema.parse(d))
  .handler(async ({ data, context }) => {
    const doc = await getDocument(data.documentId);
    if (doc.storage_path) {
      const { error } = await supabaseAdmin.storage.from(BUCKET).remove([doc.storage_path]);
      if (error) throw new Error(error.message);
    }
    const { error } = await supabaseAdmin.from("member_documents").delete().eq("id", doc.id);
    if (error) throw new Error(error.message);
    await audit(
      context.userId,
      "member.document.deleted",
      doc.id,
      { user_id: doc.user_id, title: doc.title, had_file: Boolean(doc.storage_path) },
      null,
    );
    return { ok: true };
  });
