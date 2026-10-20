import { strict as assert } from "node:assert";
import { test } from "node:test";
import { extractUazapiPhone } from "./uazapi.identity.ts";
import {
  allowedMediaMime,
  matchesMediaSignature,
  mediaKind,
  normalizedReceipt,
  safeUazapiMediaUrl,
} from "./uazapi.media.ts";

test("confirmed owner wins over device JID; LID is not a phone", () => {
  assert.equal(
    extractUazapiPhone({
      owner: "5516994213312",
      status: { jid: { user: "551699421331266", device: 66, server: "s.whatsapp.net" } },
    }),
    "5516994213312",
  );
  assert.equal(
    extractUazapiPhone({ status: { jid: { user: "34613762500:2", server: "s.whatsapp.net" } } }),
    "34613762500",
  );
  assert.equal(
    extractUazapiPhone({ status: { jid: { user: "123456789012345", server: "lid" } } }),
    null,
  );
  assert.equal(extractUazapiPhone({ owner: "not-a-number" }), null);
});

test("media classification, safe source and file signature", () => {
  assert.equal(mediaKind("ImageMessage"), "image");
  assert.equal(mediaKind("AudioMessage"), "audio");
  assert.equal(mediaKind("VideoMessage"), "video");
  assert.equal(mediaKind("DocumentMessage"), "document");
  assert.equal(mediaKind("ExtendedTextMessage"), null);
  assert.equal(allowedMediaMime("video", "video/mp4"), true);
  assert.equal(allowedMediaMime("video", "video/webm"), false);
  assert.equal(matchesMediaSignature("audio/ogg", new TextEncoder().encode("OggSdata")), true);
  assert.equal(matchesMediaSignature("video/mp4", new TextEncoder().encode("not-an-mp4")), false);
  assert.equal(safeUazapiMediaUrl("https://senseys.uazapi.com/files/abc"), true);
  assert.equal(safeUazapiMediaUrl("http://senseys.uazapi.com/files/abc"), false);
  assert.equal(safeUazapiMediaUrl("https://127.0.0.1/files/abc"), false);
  assert.equal(safeUazapiMediaUrl("https://senseys.uazapi.com.evil.test/files/abc"), false);
});

test("receipts never imply delivery from a send acknowledgment", () => {
  assert.equal(normalizedReceipt("Queued"), "pending");
  assert.equal(normalizedReceipt("Sent"), "sent");
  assert.equal(normalizedReceipt("Delivered"), "delivered");
  assert.equal(normalizedReceipt("Read"), "read");
  assert.equal(normalizedReceipt("Failed"), "failed");
});
