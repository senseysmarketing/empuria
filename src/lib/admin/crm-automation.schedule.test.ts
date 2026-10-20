import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  defaultScheduleWindow,
  isWithinWindow,
  nextAllowedRunAt,
} from "./crm-automation.schedule.ts";

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

test("janela desligada nao restringe nem atrasa o proximo envio", () => {
  const now = new Date("2026-07-05T02:17:00Z");
  assert.equal(isWithinWindow(now, { ...window, enabled: false }), true);
  assert.equal(
    nextAllowedRunAt(now, { ...window, enabled: false }).toISOString(),
    now.toISOString(),
  );
  assert.equal(defaultScheduleWindow().enabled, true);
  assert.equal(defaultScheduleWindow({ enabled: false }).enabled, false);
});

test("Lisboa e Sao Paulo usam horario local e suas regras de DST", () => {
  const lisboa = { ...window, timezone: "Europe/Lisbon" };
  const saoPaulo = { ...window, timezone: "America/Sao_Paulo" };
  assert.equal(isWithinWindow(new Date("2026-01-05T09:00:00Z"), lisboa), true);
  assert.equal(isWithinWindow(new Date("2026-07-06T08:00:00Z"), lisboa), true);
  assert.equal(isWithinWindow(new Date("2026-07-06T12:00:00Z"), saoPaulo), true);
  assert.equal(isWithinWindow(new Date("2026-07-06T11:59:00Z"), saoPaulo), false);
});
