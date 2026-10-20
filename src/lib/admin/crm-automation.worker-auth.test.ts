import { strict as assert } from "node:assert";
import { test } from "node:test";
import { workerSecretIsValid } from "./crm-automation.worker-auth.ts";

test("worker aceita apenas header e falha fechado sem segredo", () => {
  assert.equal(workerSecretIsValid(new Headers(), undefined), false);
  assert.equal(workerSecretIsValid(new Headers(), "abc"), false);
  assert.equal(workerSecretIsValid(new Headers({ "x-cron-secret": "abc" }), "abc"), true);
  assert.equal(workerSecretIsValid(new Headers({ authorization: "Bearer abc" }), "abc"), true);
  assert.equal(workerSecretIsValid(new Headers({ authorization: "Bearer errado" }), "abc"), false);
});
