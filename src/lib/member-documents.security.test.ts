import test from "node:test";
import assert from "node:assert/strict";
import {
  MEMBER_DOCUMENT_MAX_BYTES,
  isMemberDocumentPath,
  memberCanSeeDocument,
  memberCanUploadDocument,
  resolveMemberMimeType,
  validateMemberFile,
} from "./member-documents.security";

const memberA = "11111111-1111-4111-8111-111111111111";
const memberB = "22222222-2222-4222-8222-222222222222";
const documentId = "33333333-3333-4333-8333-333333333333";
const fileId = "44444444-4444-4444-8444-444444444444";

test("owner only sees visible documents, never internal or another member's", () => {
  const visible = { user_id: memberA, visible_to_member: true, status: "requested" };
  const internal = { ...visible, visible_to_member: false };
  assert.equal(memberCanSeeDocument(visible, memberA), true);
  assert.equal(memberCanSeeDocument(visible, memberB), false);
  assert.equal(memberCanSeeDocument(internal, memberA), false);
});

test("member uploads only requested/replacement own visible documents", () => {
  const doc = { user_id: memberA, visible_to_member: true, status: "requested" };
  assert.equal(memberCanUploadDocument(doc, memberA), true);
  assert.equal(memberCanUploadDocument({ ...doc, status: "needs_replacement" }, memberA), true);
  assert.equal(memberCanUploadDocument({ ...doc, status: "approved" }, memberA), false);
  assert.equal(memberCanUploadDocument({ ...doc, status: "received" }, memberA), false);
  assert.equal(memberCanUploadDocument(doc, memberB), false);
  assert.equal(memberCanUploadDocument({ ...doc, visible_to_member: false }, memberA), false);
});

test("MIME and 20 MB limits are enforced", () => {
  assert.equal(
    validateMemberFile({
      fileName: "Identificação.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 100,
    }),
    "Identificacao.pdf",
  );
  assert.throws(() =>
    validateMemberFile({
      fileName: "bad.exe",
      mimeType: "application/x-msdownload",
      fileSizeBytes: 100,
    }),
  );
  assert.equal(
    resolveMemberMimeType("documento.docx", ""),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.throws(() =>
    validateMemberFile({
      fileName: "fake.jpg",
      mimeType: "application/pdf",
      fileSizeBytes: 100,
    }),
  );
  assert.throws(() =>
    validateMemberFile({
      fileName: "large.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: MEMBER_DOCUMENT_MAX_BYTES + 1,
    }),
  );
});

test("finalization path is scoped to both owner and document", () => {
  const name = "passport.pdf";
  const valid = `${memberA}/${documentId}/${fileId}-${name}`;
  assert.equal(isMemberDocumentPath(valid, memberA, documentId, name), true);
  assert.equal(isMemberDocumentPath(valid, memberB, documentId, name), false);
  assert.equal(isMemberDocumentPath(valid, memberA, memberB, name), false);
  assert.equal(
    isMemberDocumentPath(`${memberA}/${documentId}/../${name}`, memberA, documentId, name),
    false,
  );
});
