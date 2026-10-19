import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  belongsToUazapiInstance,
  confirmedInstanceWebhook,
  equalSecret,
  redactUazapiValue,
  uazapiEventType,
} from "./uazapi.webhook.ts";

const expected = {
  token: "fake-instance-token",
  id: "expected-id",
  name: "instituto-empuria",
  baseUrl: "https://senseys.uazapi.com",
};

test("connection EventType wins over Disconnected transition type", () => {
  assert.equal(
    uazapiEventType({ EventType: "connection", type: "Disconnected" }, false),
    "connection",
  );
  assert.equal(uazapiEventType({ event: "messages" }, true), "messages");
});

test("webhook payload must match the configured instance when identity is present", () => {
  assert.equal(equalSecret("fake-secret", "fake-secret"), true);
  assert.equal(equalSecret("fake-secret", "other-secret"), false);
  assert.equal(
    belongsToUazapiInstance(
      {
        token: expected.token,
        instanceName: expected.name,
        instance: { id: expected.id, status: "connected" },
      },
      expected,
    ),
    true,
  );
  assert.equal(belongsToUazapiInstance({ token: "wrong" }, expected), false);
  assert.equal(
    belongsToUazapiInstance({ token: expected.token, instanceName: "other" }, expected),
    false,
  );
  assert.equal(
    belongsToUazapiInstance({ token: expected.token, instance: { id: "other" } }, expected),
    false,
  );
});

test("webhook is configured only after Uazapi confirms URL and required events", () => {
  const url = "https://example.test/api/webhooks/uazapi?token=fake-secret";
  const events = ["messages", "messages_update", "connection"];
  assert.equal(confirmedInstanceWebhook([{ url, enabled: true, events }], url, events)?.url, url);
  assert.equal(
    confirmedInstanceWebhook({ webhooks: [{ url, enabled: true, events }] }, url, events)?.url,
    url,
  );
  assert.equal(
    confirmedInstanceWebhook([{ url, enabled: true, events: ["messages"] }], url, events),
    null,
  );
  assert.equal(confirmedInstanceWebhook([{ url, enabled: false, events }], url, events), null);
});

test("stored webhook payload removes tokens and secret query parameters recursively", () => {
  const safe = redactUazapiValue({
    token: "fake-instance-token",
    instance: { admintoken: "fake-admin-token", openai_apikey: "fake-key", status: "connected" },
    url: "https://example.test/hook?token=fake-webhook-secret&event=connection",
    messages: [{ authorization: "Bearer fake", text: "ola" }],
  }) as Record<string, unknown>;
  assert.equal("token" in safe, false);
  assert.equal((safe.instance as Record<string, unknown>).status, "connected");
  assert.equal("admintoken" in (safe.instance as Record<string, unknown>), false);
  assert.equal("openai_apikey" in (safe.instance as Record<string, unknown>), false);
  assert.equal((safe.url as string).includes("fake-webhook-secret"), false);
  assert.equal("authorization" in (safe.messages as Record<string, unknown>[])[0], false);
});
