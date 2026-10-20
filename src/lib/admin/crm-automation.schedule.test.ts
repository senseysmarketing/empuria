import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isWithinWindow, nextAllowedRunAt } from "./crm-automation.schedule.ts";

const window = {
  timezone: "Europe/Madrid",
  weekdays: [1, 2, 3, 4, 5],
  start: "09:00",
  end: "18:00",
};

test("janela usa horario local de Madrid no inverno e no verao", () => {
  assert.equal(isWithinWindow(new Date("2026-01-05T08:00:00Z"), window), true);
  assert.equal(isWithinWindow(new Date("2026-07-06T07:00:00Z"), window), true);
  assert.equal(isWithinWindow(new Date("2026-07-06T06:59:00Z"), window), false);
});

test("proximo horario respeita o salto de horario de verao", () => {
  assert.equal(
    nextAllowedRunAt(new Date("2026-03-29T01:00:00Z"), window).toISOString(),
    "2026-03-30T07:00:00.000Z",
  );
});
