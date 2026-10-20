import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderCrmAutomationTemplate } from "./crm-automation.template.ts";

test("variaveis com uma ou duas chaves usam dados explicitos", () => {
  assert.equal(
    renderCrmAutomationTemplate("Oi {primeiro_nome}, {objetivo} em {{etapa}}", {
      nome: "Ana Silva",
      objetivo: "Residencia",
      etapa: "Em contato",
    }),
    "Oi Ana, Residencia em Em contato",
  );
});

test("variavel ausente ou desconhecida nunca sai crua", () => {
  assert.throws(() => renderCrmAutomationTemplate("{servico}", { nome: "Ana" }), /sem dado/);
  assert.throws(() => renderCrmAutomationTemplate("{{token}}", { nome: "Ana" }), /desconhecida/);
});
