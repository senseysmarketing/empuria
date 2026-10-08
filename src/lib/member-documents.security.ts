export const MEMBER_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;
export const MEMBER_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function resolveMemberMimeType(fileName: string, browserMime: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const expected = MIME_BY_EXTENSION[extension];
  if (!expected || (browserMime && browserMime !== expected)) {
    throw new Error("Extensão e tipo do arquivo não correspondem");
  }
  return expected;
}

export type MemberDocumentAccess = {
  user_id: string;
  visible_to_member: boolean;
  status: string;
};

export function memberCanSeeDocument(
  doc: Pick<MemberDocumentAccess, "user_id" | "visible_to_member">,
  userId: string,
) {
  return doc.user_id === userId && doc.visible_to_member;
}

export function memberCanUploadDocument(doc: MemberDocumentAccess, userId: string) {
  return (
    memberCanSeeDocument(doc, userId) &&
    (doc.status === "requested" || doc.status === "needs_replacement")
  );
}

export function validateMemberFile(input: {
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
}) {
  if (!MEMBER_DOCUMENT_MIME_TYPES.has(input.mimeType)) {
    throw new Error("Tipo de arquivo não permitido");
  }
  resolveMemberMimeType(input.fileName, input.mimeType);
  if (input.fileSizeBytes <= 0 || input.fileSizeBytes > MEMBER_DOCUMENT_MAX_BYTES) {
    throw new Error("Arquivo maior que 20 MB ou vazio");
  }
  const safeName = input.fileName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  if (!safeName) throw new Error("Nome de arquivo inválido");
  return safeName;
}

export function isMemberDocumentPath(
  path: string,
  userId: string,
  documentId: string,
  safeName: string,
) {
  const prefix = `${userId}/${documentId}/`;
  const name = path.slice(prefix.length);
  return (
    path.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-zA-Z._-]+$/i.test(name) &&
    name.endsWith(`-${safeName}`)
  );
}
