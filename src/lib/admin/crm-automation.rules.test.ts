import { strict as assert } from "node:assert";
import { test } from "node:test";
import { defaultStopRules, shouldStopForLead } from "./crm-automation.rules.ts";

test("defaults apply only when flags are absent", () => {
  assert.deepEqual(defaultStopRules(), {
    stop_on_reply: true,
    stop_on_final_stage: true,
    avoid_conflicts: true,
    on_reply_move_stage_enabled: false,
    on_reply_move_stage: null,
  });
  const disabled = defaultStopRules({
    stop_on_reply: false,
    stop_on_final_stage: false,
    avoid_conflicts: false,
    on_reply_move_stage_enabled: true,
    on_reply_move_stage: "column-id",
    max_messages_per_lead: 4,
    min_minutes_between_messages: 15,
  });
  assert.equal(disabled.stop_on_reply, false);
  assert.equal(disabled.stop_on_final_stage, false);
  assert.equal(disabled.avoid_conflicts, false);
  assert.equal(disabled.on_reply_move_stage_enabled, true);
  assert.equal(disabled.on_reply_move_stage, "column-id");
  assert.equal("max_messages_per_lead" in disabled, false);
});

test("reply and final-stage stopping obey independent flags", () => {
  const enabled = defaultStopRules();
  assert.equal(shouldStopForLead(enabled, "novo", true), "lead_replied");
  assert.equal(shouldStopForLead(enabled, "fechado", false), "final_stage");
  assert.equal(shouldStopForLead(enabled, "descartado", false), "final_stage");
  const disabled = defaultStopRules({ stop_on_reply: false, stop_on_final_stage: false });
  assert.equal(shouldStopForLead(disabled, "fechado", true), null);
});
