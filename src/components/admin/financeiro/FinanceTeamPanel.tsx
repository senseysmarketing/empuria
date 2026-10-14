import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BentoCard } from "@/components/admin/BentoCard";
import { SettleTransactionPopover } from "./SettleTransactionPopover";
import {
  settleFinanceTransaction,
  reverseFinanceSettlement,
} from "@/lib/admin/financeiro.functions";
import {
  listFinanceTeamMonth,
  saveFinanceTeamCompensation,
  skipFinanceGoalCommission,
  setFinanceTeamRuleState,
  setFinanceTeamMemberState,
  type FinancePayee,
  type FinancePayoutRule,
  type FinanceTeamMember,
} from "@/lib/admin/finance-team.functions";

type Currency = "BRL" | "EUR";
type RuleType = FinancePayoutRule["rule_type"];
type RuleValues = {
  id: string | null;
  ruleType: RuleType;
  amountCents: number | null;
  currency: Currency | null;
  percentage: number | null;
  includeBrl: boolean;
  includeEur: boolean;
  dayOfMonth: number | null;
  serviceIds: string[];
};
type FormValues = {
  name: string;
  type: FinancePayee["type"];
  notes: string | null;
  rules: RuleValues[];
};

const PAYEE_TYPES: Record<FinancePayee["type"], string> = {
  team: "Equipe",
  contractor: "Prestador",
  partner: "Parceiro",
  supplier: "Fornecedor",
  other: "Outro",
};
const RULE_TYPES: Record<RuleType, string> = {
  fixed_monthly: "Fixo mensal",
  goal_cap: "Comissão por metas",
  revenue_percent: "% da receita realizada",
  service_percent: "% dos serviços selecionados",
};
function emptyRule(ruleType: RuleType = "fixed_monthly"): RuleValues {
  return {
    id: null,
    ruleType,
    amountCents: null,
    currency: "BRL",
    percentage: null,
    includeBrl: true,
    includeEur: true,
    dayOfMonth: 1,
    serviceIds: [],
  };
}
const EMPTY_FORM: FormValues = { name: "", type: "team", notes: null, rules: [emptyRule()] };

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function ruleDescription(rule: FinancePayoutRule | null) {
  if (!rule) return "Sem configuração ativa neste mês";
  if (rule.rule_type === "fixed_monthly" || rule.rule_type === "goal_cap")
    return `${RULE_TYPES[rule.rule_type]} · ${money(rule.amount_cents ?? 0, rule.currency ?? "BRL")} · dia ${rule.day_of_month}`;
  const currencies = [rule.include_brl && "BRL", rule.include_eur && "EUR"]
    .filter(Boolean)
    .join(" / ");
  return `${RULE_TYPES[rule.rule_type]} · ${rule.percentage}% · ${currencies}${rule.rule_type === "service_percent" ? ` · ${rule.service_ids.length} serviço(s)` : ""}`;
}

function financialChanged(values: FormValues, rules: FinancePayoutRule[]) {
  if (values.rules.length !== rules.length) return true;
  return values.rules.some((value) => {
    const rule = rules.find((item) => item.id === value.id);
    if (!rule) return true;
    return (
      value.ruleType !== rule.rule_type ||
      value.amountCents !== rule.amount_cents ||
      value.currency !== rule.currency ||
      value.dayOfMonth !== rule.day_of_month ||
      value.percentage !== rule.percentage ||
      value.includeBrl !== rule.include_brl ||
      value.includeEur !== rule.include_eur ||
      [...value.serviceIds].sort().join() !== [...rule.service_ids].sort().join()
    );
  });
}

export function FinanceTeamPanel({ month, onChanged }: { month: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listFinanceTeamMonth);
  const save = useServerFn(saveFinanceTeamCompensation);
  const setState = useServerFn(setFinanceTeamMemberState);
  const setRuleState = useServerFn(setFinanceTeamRuleState);
  const skipGoal = useServerFn(skipFinanceGoalCommission);
  const settle = useServerFn(settleFinanceTransaction);
  const reverse = useServerFn(reverseFinanceSettlement);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<FinanceTeamMember | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [serviceSearch, setServiceSearch] = useState("");
  const [expandedRule, setExpandedRule] = useState<number | null>(0);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [stateTarget, setStateTarget] = useState<{
    member: FinanceTeamMember;
    action: "pause" | "remove";
  } | null>(null);
  const [removePending, setRemovePending] = useState(true);

  const teamQ = useQuery({
    queryKey: ["finance-team", month, showArchived],
    queryFn: () => list({ data: { month, showArchived } }),
  });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["finance-team"] });
    onChanged();
  };
  const saveMutation = useMutation({
    mutationFn: (choice: { mode: "current" | "next_month" }) =>
      save({
        data: {
          payeeId: editing?.payee.id ?? null,
          month: `${month}-01`,
          ...choice,
          ...form,
        },
      }),
    onSuccess: () => {
      toast.success("Pessoa e remunerações salvas");
      setFormOpen(false);
      setDecisionOpen(false);
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao salvar"),
  });
  const stateMutation = useMutation({
    mutationFn: (input: {
      payeeId: string;
      action: "pause" | "reactivate" | "remove";
      removePending: boolean;
    }) => setState({ data: { ...input, month: `${month}-01` } }),
    onSuccess: () => {
      toast.success("Situação atualizada");
      setStateTarget(null);
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao atualizar"),
  });
  const reverseMutation = useMutation({
    mutationFn: (input: { id: string; reason: string }) => reverse({ data: input }),
    onSuccess: () => {
      toast.success("Baixa estornada; repasse será recalculado");
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao estornar"),
  });
  const skipMutation = useMutation({
    mutationFn: (ruleId: string) => skipGoal({ data: { ruleId, month: `${month}-01` } }),
    onSuccess: () => {
      toast.success("Comissão encerrada sem pagamento neste mês");
      changed();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao encerrar comissão"),
  });
  const ruleStateMutation = useMutation({
    mutationFn: (input: { ruleId: string; action: "pause" | "reactivate" | "remove" }) =>
      setRuleState({ data: { ...input, month: `${month}-01`, removePending: true } }),
    onSuccess: () => {
      toast.success("Remuneração atualizada");
      changed();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Erro ao atualizar remuneração"),
  });

  function openForm(member: FinanceTeamMember | null) {
    const payee = member?.payee;
    setEditing(member);
    setForm({
      name: payee?.name ?? "",
      type: payee?.type ?? "team",
      notes: payee?.notes ?? null,
      rules: member?.rules.length
        ? member.rules.map((rule) => ({
            id: rule.id,
            ruleType: rule.rule_type,
            amountCents: rule.amount_cents,
            currency: (rule.currency as Currency) ?? null,
            percentage: rule.percentage,
            includeBrl: rule.include_brl,
            includeEur: rule.include_eur,
            dayOfMonth: rule.day_of_month,
            serviceIds: rule.service_ids,
          }))
        : [emptyRule()],
    });
    setServiceSearch("");
    setExpandedRule(0);
    setFormOpen(true);
  }

  const changedRuleIds = form.rules
    .filter((rule) => {
      const existing = editing?.rules.find((item) => item.id === rule.id);
      return existing && financialChanged({ ...form, rules: [rule] }, [existing]);
    })
    .map((rule) => rule.id);
  const hasPaid = !!editing?.payouts.some(
    ({ payout, transaction }) =>
      transaction?.status === "paid" && changedRuleIds.includes(payout.rule_id),
  );
  const valid =
    form.name.trim().length >= 2 &&
    form.rules.length > 0 &&
    form.rules.every((rule) =>
      rule.ruleType === "fixed_monthly" || rule.ruleType === "goal_cap"
        ? rule.amountCents !== null && rule.amountCents >= 0 && !!rule.currency && !!rule.dayOfMonth
        : !!rule.percentage &&
          (rule.includeBrl || rule.includeEur) &&
          (rule.ruleType !== "service_percent" || rule.serviceIds.length > 0),
    );
  function updateRule(index: number, patch: Partial<RuleValues>) {
    setForm((previous) => ({
      ...previous,
      rules: previous.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    }));
  }
  const data = teamQ.data;

  return (
    <div className="space-y-4">
      {teamQ.error && <p className="text-sm text-red-700">{teamQ.error.message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => openForm(null)}>Adicionar pessoa</Button>
        <span className="text-sm text-admin-ink-muted">
          Repasses pendentes são sincronizados automaticamente com a receita realizada.
        </span>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Mostrar removidos
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["BRL", "EUR"] as const).map((currency) => (
          <BentoCard key={currency} title={`Repasses ${currency}`}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                A pagar
                <div className="font-semibold">
                  {money(data?.totals[currency].payable ?? 0, currency)}
                </div>
              </div>
              <div>
                Pago
                <div className="font-semibold">
                  {money(data?.totals[currency].paid ?? 0, currency)}
                </div>
              </div>
            </div>
          </BentoCard>
        ))}
      </div>
      <BentoCard title="Pessoas e repasses">
        {teamQ.isPending && <p className="text-sm text-admin-ink-muted">Carregando…</p>}
        {!teamQ.isPending && !data?.members.length && (
          <p className="text-sm text-admin-ink-muted">Nenhuma pessoa cadastrada.</p>
        )}
        <div className="space-y-3">
          {data?.members.map((member) => {
            const { payee, rules } = member;
            const memberTotals = {
              BRL: { planned: 0, payable: 0, paid: 0 },
              EUR: { planned: 0, payable: 0, paid: 0 },
            };
            for (const { payout, transaction } of member.payouts) {
              if (transaction?.status === "pending" || transaction?.status === "paid")
                memberTotals[payout.currency === "EUR" ? "EUR" : "BRL"].planned +=
                  payout.amount_cents;
              if (transaction?.status === "pending")
                memberTotals[payout.currency === "EUR" ? "EUR" : "BRL"].payable +=
                  payout.amount_cents;
              if (transaction?.status === "paid")
                memberTotals[transaction.settled_currency === "EUR" ? "EUR" : "BRL"].paid +=
                  transaction.settled_amount_cents ?? payout.amount_cents;
            }
            return (
              <section key={payee.id} className="rounded-lg border border-admin-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{payee.name}</strong>
                    <div className="text-admin-ink-muted">
                      {PAYEE_TYPES[payee.type]} ·{" "}
                      {payee.archived_at ? "Removido" : payee.is_active ? "Ativo" : "Pausado"}
                    </div>
                    <div className="text-admin-ink-muted">
                      {rules.length
                        ? rules.map((rule) => (
                            <div key={rule.id} className="flex flex-wrap items-center gap-2">
                              <span>
                                {ruleDescription(rule)}
                                {!rule.is_active ? " · Pausado" : ""}
                                {member.skipped_rule_ids.includes(rule.id)
                                  ? " · Sem comissão neste mês"
                                  : ""}
                              </span>
                              {!payee.archived_at && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={ruleStateMutation.isPending}
                                  onClick={() =>
                                    ruleStateMutation.mutate({
                                      ruleId: rule.id,
                                      action: rule.is_active ? "pause" : "reactivate",
                                    })
                                  }
                                >
                                  {rule.is_active ? "Pausar modalidade" : "Reativar modalidade"}
                                </Button>
                              )}
                            </div>
                          ))
                        : "Sem configuração ativa neste mês"}
                    </div>
                    <div className="mt-1 text-xs text-admin-ink-muted">
                      Previsto: {money(memberTotals.BRL.planned, "BRL")} ·{" "}
                      {money(memberTotals.EUR.planned, "EUR")}
                      {" · "}A pagar: {money(memberTotals.BRL.payable, "BRL")} ·{" "}
                      {money(memberTotals.EUR.payable, "EUR")}
                      {" · "}Pago: {money(memberTotals.BRL.paid, "BRL")} ·{" "}
                      {money(memberTotals.EUR.paid, "EUR")}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!payee.archived_at && (
                      <Button size="sm" variant="outline" onClick={() => openForm(member)}>
                        Editar
                      </Button>
                    )}
                    {!payee.archived_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={stateMutation.isPending}
                        onClick={() =>
                          payee.is_active
                            ? (setRemovePending(true), setStateTarget({ member, action: "pause" }))
                            : stateMutation.mutate({
                                payeeId: payee.id,
                                action: "reactivate",
                                removePending: false,
                              })
                        }
                      >
                        {payee.is_active ? "Pausar" : "Reativar"}
                      </Button>
                    )}
                    {!payee.archived_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRemovePending(true);
                          setStateTarget({ member, action: "remove" });
                        }}
                      >
                        Remover
                      </Button>
                    )}
                  </div>
                </div>
                {member.payouts.map(({ payout, transaction }) => (
                  <div
                    key={payout.id}
                    className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-2"
                  >
                    <div>
                      <div className="text-admin-ink-muted">
                        {
                          RULE_TYPES[
                            rules.find((rule) => rule.id === payout.rule_id)?.rule_type ??
                              "fixed_monthly"
                          ]
                        }
                      </div>
                      <strong>{money(payout.amount_cents, payout.currency)}</strong> ·{" "}
                      {transaction?.status === "paid"
                        ? "Pago"
                        : transaction?.status === "pending"
                          ? "A pagar"
                          : "Sem valor a pagar"}
                      {payout.percentage !== null && (
                        <div className="text-admin-ink-muted">
                          Base {money(payout.base_amount_cents, payout.currency)} ×{" "}
                          {payout.percentage}%
                        </div>
                      )}
                      {transaction?.status === "paid" &&
                        transaction.settled_amount_cents != null && (
                          <div className="text-admin-ink-muted">
                            Realizado{" "}
                            {money(
                              transaction.settled_amount_cents,
                              transaction.settled_currency ?? payout.currency,
                            )}
                          </div>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {transaction?.status === "pending" && (
                        <SettleTransactionPopover
                          transaction={transaction}
                          settle={(input) => settle({ data: input })}
                          onDone={changed}
                        />
                      )}
                      {transaction?.status === "pending" &&
                        rules.find((rule) => rule.id === payout.rule_id)?.rule_type ===
                          "goal_cap" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={skipMutation.isPending}
                            onClick={() => {
                              if (window.confirm("Encerrar esta comissão sem pagamento neste mês?"))
                                skipMutation.mutate(payout.rule_id);
                            }}
                          >
                            Sem comissão neste mês
                          </Button>
                        )}
                      {transaction?.status === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const reason = window.prompt("Motivo obrigatório do estorno da baixa:");
                            if (reason?.trim() && reason.trim().length >= 3)
                              reverseMutation.mutate({ id: transaction.id, reason: reason.trim() });
                          }}
                        >
                          Estornar baixa
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      </BentoCard>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar pessoa e remunerações" : "Adicionar pessoa e remunerações"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              if (editing && financialChanged(form, editing.rules)) setDecisionOpen(true);
              else saveMutation.mutate({ mode: "current" });
            }}
          >
            <div>
              <Label>Nome</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.type}
                onValueChange={(value) => setForm({ ...form, type: value as FormValues["type"] })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PAYEE_TYPES).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea
                value={form.notes ?? ""}
                onChange={(event) => setForm({ ...form, notes: event.target.value || null })}
              />
            </div>
            <div className="space-y-2">
              <Label>Remuneração e repasses</Label>
              {form.rules.map((rule, index) => (
                <section
                  key={rule.id ?? `new-${index}`}
                  className="rounded-lg border border-admin-border p-3"
                >
                  <button
                    type="button"
                    className="flex w-full justify-between text-left text-sm font-medium"
                    onClick={() => setExpandedRule(expandedRule === index ? null : index)}
                  >
                    <span>
                      {RULE_TYPES[rule.ruleType]}{" "}
                      {rule.amountCents !== null &&
                      (rule.ruleType === "fixed_monthly" || rule.ruleType === "goal_cap")
                        ? `· ${money(rule.amountCents, rule.currency ?? "BRL")}`
                        : ""}
                    </span>
                    <span>{expandedRule === index ? "Recolher" : "Editar"}</span>
                  </button>
                  {expandedRule === index && (
                    <div className="mt-3 space-y-3">
                      <div>
                        <Label>Modalidade</Label>
                        <Select
                          value={rule.ruleType}
                          onValueChange={(value) =>
                            updateRule(index, { ruleType: value as RuleType })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(RULE_TYPES).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {rule.ruleType === "fixed_monthly" || rule.ruleType === "goal_cap" ? (
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label>{rule.ruleType === "goal_cap" ? "Teto máximo" : "Valor"}</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={rule.amountCents === null ? "" : rule.amountCents / 100}
                              onChange={(event) =>
                                updateRule(index, {
                                  amountCents: event.target.value
                                    ? Math.round(Number(event.target.value) * 100)
                                    : null,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label>Moeda</Label>
                            <Select
                              value={rule.currency ?? "BRL"}
                              onValueChange={(value) =>
                                updateRule(index, { currency: value as Currency })
                              }
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BRL">BRL</SelectItem>
                                <SelectItem value="EUR">EUR</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Dia</Label>
                            <Input
                              type="number"
                              min="1"
                              max="31"
                              value={rule.dayOfMonth ?? ""}
                              onChange={(event) =>
                                updateRule(index, {
                                  dayOfMonth: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div>
                            <Label>Percentual</Label>
                            <Input
                              type="number"
                              min="0.0001"
                              max="100"
                              step="0.0001"
                              value={rule.percentage ?? ""}
                              onChange={(event) =>
                                updateRule(index, {
                                  percentage: event.target.value
                                    ? Number(event.target.value)
                                    : null,
                                })
                              }
                            />
                          </div>
                          <div className="flex gap-4 text-sm">
                            Recebe sobre:
                            <label>
                              <input
                                type="checkbox"
                                checked={rule.includeBrl}
                                onChange={(event) =>
                                  updateRule(index, { includeBrl: event.target.checked })
                                }
                              />{" "}
                              BRL
                            </label>
                            <label>
                              <input
                                type="checkbox"
                                checked={rule.includeEur}
                                onChange={(event) =>
                                  updateRule(index, { includeEur: event.target.checked })
                                }
                              />{" "}
                              EUR
                            </label>
                          </div>
                        </div>
                      )}
                      {rule.ruleType === "service_percent" && (
                        <div>
                          <Label>Serviços ({rule.serviceIds.length} selecionado(s))</Label>
                          <Input
                            value={serviceSearch}
                            onChange={(event) => setServiceSearch(event.target.value)}
                            placeholder="Buscar serviço"
                          />
                          <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded border border-admin-border p-2">
                            {data?.services
                              .filter((service) =>
                                service.title.toLowerCase().includes(serviceSearch.toLowerCase()),
                              )
                              .map((service) => (
                                <label key={service.id} className="flex items-center gap-2 text-sm">
                                  <input
                                    type="checkbox"
                                    checked={rule.serviceIds.includes(service.id)}
                                    onChange={(event) =>
                                      updateRule(index, {
                                        serviceIds: event.target.checked
                                          ? [...rule.serviceIds, service.id]
                                          : rule.serviceIds.filter((id) => id !== service.id),
                                      })
                                    }
                                  />
                                  {service.title}
                                </label>
                              ))}
                          </div>
                        </div>
                      )}
                      {rule.id === null && form.rules.length > 1 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setForm((previous) => ({
                              ...previous,
                              rules: previous.rules.filter((_, i) => i !== index),
                            }));
                            setExpandedRule(null);
                          }}
                        >
                          Remover bloco
                        </Button>
                      )}
                    </div>
                  )}
                </section>
              ))}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setForm((previous) => ({
                    ...previous,
                    rules: [...previous.rules, emptyRule("goal_cap")],
                  }));
                  setExpandedRule(form.rules.length);
                }}
              >
                Adicionar remuneração
              </Button>
            </div>
            <Button type="submit" disabled={!valid || saveMutation.isPending}>
              Salvar pessoa
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={decisionOpen} onOpenChange={setDecisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Quando aplicar a alteração?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-admin-ink-muted">
            {hasPaid
              ? "Uma modalidade alterada já tem repasse pago. Estorne essa baixa explicitamente antes de atualizar o mês atual."
              : "O repasse pendente deste mês será recalculado sem criar duplicatas."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ mode: "next_month" })}
            >
              Aplicar a partir do próximo mês
            </Button>
            <Button
              disabled={saveMutation.isPending || hasPaid}
              onClick={() => saveMutation.mutate({ mode: "current" })}
            >
              Atualizar mês atual
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!stateTarget} onOpenChange={(open) => !open && setStateTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {stateTarget?.action === "remove" ? "Remover pessoa" : "Pausar pessoa"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-admin-ink-muted">
            O histórico pago será preservado. Novos repasses deixam de ser gerados.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={removePending}
              onChange={(event) => setRemovePending(event.target.checked)}
            />
            Remover repasses pendentes deste mês
          </label>
          <Button
            disabled={stateMutation.isPending}
            onClick={() =>
              stateTarget &&
              stateMutation.mutate({
                payeeId: stateTarget.member.payee.id,
                action: stateTarget.action,
                removePending,
              })
            }
          >
            Confirmar
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
