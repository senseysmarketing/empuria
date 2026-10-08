import { useMemo, useState } from "react";
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
import type { FinanceAccount } from "@/lib/admin/financeiro.functions";
import {
  createFinanceAccount,
  settleFinanceTransaction,
  deleteFinancePendingTransaction,
  reverseFinanceSettlement,
} from "@/lib/admin/financeiro.functions";
import {
  createFinancePayee,
  updateFinancePayee,
  toggleFinancePayee,
  archiveFinancePayee,
  createFinancePayoutRule,
  updateFinancePayoutRule,
  toggleFinancePayoutRule,
  archiveFinancePayoutRule,
  searchFinancePayeeProfiles,
  endFinancePayoutRule,
  listFinanceTeamMonth,
  materializeFinancePayout,
  type FinancePayee,
  type FinancePayoutRule,
} from "@/lib/admin/finance-team.functions";

type Currency = "BRL" | "EUR";
type PayeeType = FinancePayee["type"];
type RuleType = FinancePayoutRule["rule_type"];

const PAYEE_TYPES: Record<PayeeType, string> = {
  team: "Equipe",
  contractor: "Prestador",
  partner: "Parceiro",
  supplier: "Fornecedor",
  other: "Outro",
};
const RULE_TYPES: Record<RuleType, string> = {
  fixed_monthly: "Fixo mensal",
  revenue_percent: "% da receita realizada",
  service_percent: "% do serviço",
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function monthStart(month: string) {
  return `${month}-01`;
}

export function FinanceTeamPanel({
  month,
  accounts,
  onChanged,
}: {
  month: string;
  accounts: FinanceAccount[];
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listFinanceTeamMonth);
  const createPayee = useServerFn(createFinancePayee);
  const updatePayee = useServerFn(updateFinancePayee);
  const togglePayee = useServerFn(toggleFinancePayee);
  const archivePayee = useServerFn(archiveFinancePayee);
  const createRule = useServerFn(createFinancePayoutRule);
  const updateRule = useServerFn(updateFinancePayoutRule);
  const toggleRule = useServerFn(toggleFinancePayoutRule);
  const archiveRule = useServerFn(archiveFinancePayoutRule);
  const searchProfiles = useServerFn(searchFinancePayeeProfiles);
  const endRule = useServerFn(endFinancePayoutRule);
  const materialize = useServerFn(materializeFinancePayout);
  const settle = useServerFn(settleFinanceTransaction);
  const deletePending = useServerFn(deleteFinancePendingTransaction);
  const reverseSettlement = useServerFn(reverseFinanceSettlement);
  const createAccount = useServerFn(createFinanceAccount);
  const [payeeOpen, setPayeeOpen] = useState(false);
  const [editingPayee, setEditingPayee] = useState<FinancePayee | null>(null);
  const [payeeType, setPayeeType] = useState<PayeeType>("team");
  const [profileId, setProfileId] = useState<string | null>(null);
  const [profileQuery, setProfileQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<FinancePayoutRule | null>(null);
  const [rulePayeeId, setRulePayeeId] = useState("");
  const [ruleType, setRuleType] = useState<RuleType>("fixed_monthly");
  const [ruleCurrency, setRuleCurrency] = useState<Currency>("BRL");
  const [includeBrl, setIncludeBrl] = useState(true);
  const [includeEur, setIncludeEur] = useState(true);
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [serviceSearch, setServiceSearch] = useState("");

  const teamQ = useQuery({
    queryKey: ["finance-team", month, showArchived],
    queryFn: () => list({ data: { month, showArchived } }),
  });
  const profileQ = useQuery({
    queryKey: ["finance-payee-profiles", profileQuery],
    queryFn: () => searchProfiles({ data: { query: profileQuery.trim() } }),
    enabled: payeeOpen && profileQuery.trim().length >= 2,
  });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["finance-team"] });
    onChanged();
  };
  const payeeMutation = useMutation({
    mutationFn: (form: FormData) => {
      const input = {
        name: String(form.get("name") ?? ""),
        type: payeeType,
        profileId,
        notes: String(form.get("notes") ?? "").trim() || null,
      };
      return editingPayee
        ? updatePayee({ data: { ...input, id: editingPayee.id } })
        : createPayee({ data: input });
    },
    onSuccess: () => {
      toast.success("Beneficiário salvo");
      setPayeeOpen(false);
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao salvar"),
  });
  const ruleMutation = useMutation({
    mutationFn: (form: FormData) => {
      const input = {
        payeeId: rulePayeeId,
        ruleType,
        amount: ruleType === "fixed_monthly" ? Number(form.get("amount") ?? 0) : null,
        currency: ruleType === "fixed_monthly" ? ruleCurrency : null,
        percentage: ruleType === "fixed_monthly" ? null : Number(form.get("percentage") ?? 0),
        serviceIds: ruleType === "service_percent" ? serviceIds : [],
        includeBrl,
        includeEur,
        dayOfMonth: ruleType === "fixed_monthly" ? Number(form.get("dayOfMonth") ?? 1) : null,
        startsOn: String(form.get("startsOn") ?? ""),
        endsOn: String(form.get("endsOn") ?? "").trim() || null,
      };
      return editingRule
        ? updateRule({ data: { id: editingRule.id, rule: input } })
        : createRule({ data: input });
    },
    onSuccess: () => {
      toast.success("Regra salva. Ocorrências já geradas permanecem intactas.");
      setRuleOpen(false);
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro ao salvar"),
  });
  const actionMutation = useMutation({
    mutationFn: (action: {
      kind: "payee" | "rule" | "end" | "materialize" | "archivePayee" | "archiveRule";
      id: string;
      active?: boolean;
      currency?: Currency;
    }) => {
      if (action.kind === "payee")
        return togglePayee({ data: { id: action.id, isActive: !!action.active } });
      if (action.kind === "rule")
        return toggleRule({ data: { id: action.id, isActive: !!action.active } });
      if (action.kind === "archivePayee") return archivePayee({ data: { id: action.id } });
      if (action.kind === "archiveRule") return archiveRule({ data: { id: action.id } });
      if (action.kind === "end")
        return endRule({ data: { id: action.id, endsOn: monthStart(month) } });
      return materialize({ data: { ruleId: action.id, month, currency: action.currency! } });
    },
    onSuccess: () => {
      toast.success("Ação concluída");
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro na ação"),
  });
  const transactionMutation = useMutation({
    mutationFn: async (input: {
      id: string;
      action: "delete" | "reverse";
      reason: string | null;
    }) => {
      if (input.action === "delete")
        return deletePending({ data: { id: input.id, reason: input.reason } });
      return reverseSettlement({ data: { id: input.id, reason: input.reason ?? "" } });
    },
    onSuccess: () => {
      toast.success("Repasse atualizado");
      changed();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Erro no repasse"),
  });
  const actOnTransaction = (id: string, action: "delete" | "reverse") => {
    if (action === "delete") {
      if (window.confirm("Excluir este repasse pendente? Ele não será regenerado."))
        transactionMutation.mutate({ id, action, reason: null });
      return;
    }
    const reason = window.prompt("Motivo obrigatório do estorno da baixa:");
    if (reason?.trim() && reason.trim().length >= 3)
      transactionMutation.mutate({ id, action, reason: reason.trim() });
  };

  const data = teamQ.data;
  const payeeMap = useMemo(
    () => new Map((data?.payees ?? []).map((payee) => [payee.id, payee])),
    [data],
  );
  const txMap = useMemo(() => new Map((data?.transactions ?? []).map((tx) => [tx.id, tx])), [data]);
  const payoutMap = useMemo(
    () => new Map((data?.payouts ?? []).map((payout) => [payout.id, payout])),
    [data],
  );
  const totals = useMemo(() => {
    const value = {
      BRL: { projected: 0, payable: 0, paid: 0 },
      EUR: { projected: 0, payable: 0, paid: 0 },
    };
    for (const projection of data?.projections ?? []) {
      if (!projection.payout_id)
        value[projection.currency].projected += projection.projected_amount_cents;
    }
    for (const payout of data?.payouts ?? []) {
      const tx = payout.finance_transaction_id ? txMap.get(payout.finance_transaction_id) : null;
      const currency = (
        tx?.status === "paid" ? (tx.settled_currency ?? payout.currency) : payout.currency
      ) as Currency;
      if (currency !== "BRL" && currency !== "EUR") continue;
      if (tx?.status === "paid")
        value[currency].paid += tx.settled_amount_cents ?? payout.amount_cents;
      else value[currency].payable += payout.amount_cents;
    }
    return value;
  }, [data, txMap]);

  function openPayee(payee: FinancePayee | null) {
    setEditingPayee(payee);
    setPayeeType(payee?.type ?? "team");
    setProfileId(payee?.profile_id ?? null);
    setProfileQuery("");
    setPayeeOpen(true);
  }
  function openRule(rule: FinancePayoutRule | null, payeeId?: string) {
    setEditingRule(rule);
    setRulePayeeId(
      rule?.payee_id ??
        payeeId ??
        data?.payees.find((payee) => payee.is_active && !payee.archived_at)?.id ??
        "",
    );
    setRuleType(rule?.rule_type ?? "fixed_monthly");
    setRuleCurrency((rule?.currency as Currency) ?? "BRL");
    setIncludeBrl(rule?.include_brl ?? true);
    setIncludeEur(rule?.include_eur ?? true);
    setServiceIds(rule?.service_ids ?? []);
    setServiceSearch("");
    setRuleOpen(true);
  }

  return (
    <div className="space-y-4">
      {teamQ.error && <p className="text-sm text-red-700">{teamQ.error.message}</p>}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => openPayee(null)}>Novo beneficiário</Button>
        <Button variant="outline" disabled={!data?.payees.length} onClick={() => openRule(null)}>
          Nova regra
        </Button>
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Mostrar arquivados
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(["BRL", "EUR"] as const).map((currency) => (
          <BentoCard key={currency} title={`Repasses ${currency}`}>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                Projetado
                <div className="font-semibold">{money(totals[currency].projected, currency)}</div>
              </div>
              <div>
                A pagar
                <div className="font-semibold">{money(totals[currency].payable, currency)}</div>
              </div>
              <div>
                Pago<div className="font-semibold">{money(totals[currency].paid, currency)}</div>
              </div>
            </div>
          </BentoCard>
        ))}
      </div>
      <BentoCard title="Beneficiários">
        {!data?.payees.length && (
          <p className="text-sm text-admin-ink-muted">Nenhum beneficiário cadastrado.</p>
        )}
        <div className="space-y-3">
          {data?.payees.map((payee) => (
            <div
              key={payee.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-admin-border py-2 text-sm"
            >
              <div>
                <strong>{payee.name}</strong>
                <div className="text-admin-ink-muted">
                  {PAYEE_TYPES[payee.type]} ·{" "}
                  {data.rules.filter((rule) => rule.payee_id === payee.id).length} regra(s) ·{" "}
                  {payee.archived_at ? "Arquivado" : payee.is_active ? "Ativo" : "Pausado"}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openPayee(payee)}>
                  Editar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!payee.archived_at}
                  onClick={() => openRule(null, payee.id)}
                >
                  Nova regra
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!payee.archived_at}
                  onClick={() =>
                    actionMutation.mutate({ kind: "payee", id: payee.id, active: !payee.is_active })
                  }
                >
                  {payee.is_active ? "Pausar" : "Reativar"}
                </Button>
                {!payee.archived_at && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (window.confirm("Arquivar beneficiário e interromper novas projeções?"))
                        actionMutation.mutate({ kind: "archivePayee", id: payee.id });
                    }}
                  >
                    Arquivar
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </BentoCard>
      <BentoCard title="Regras e repasses do mês">
        {!data?.rules.length && (
          <p className="text-sm text-admin-ink-muted">Nenhuma regra cadastrada.</p>
        )}
        <div className="space-y-4">
          {data?.rules.map((rule) => {
            const payee = payeeMap.get(rule.payee_id);
            const fixedPayouts = data.payouts.filter(
              (payout) => payout.rule_id === rule.id && rule.rule_type === "fixed_monthly",
            );
            const projections = data.projections.filter(
              (projection) => projection.rule_id === rule.id,
            );
            const historicalPayouts = data.payouts.filter(
              (payout) =>
                payout.rule_id === rule.id &&
                payout.percentage !== null &&
                !projections.some((projection) => projection.payout_id === payout.id),
            );
            return (
              <section key={rule.id} className="rounded-lg border border-admin-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <strong>{payee?.name ?? "Beneficiário"}</strong>
                    <div className="text-admin-ink-muted">
                      {RULE_TYPES[rule.rule_type]} · {rule.starts_on.slice(0, 7)}
                      {rule.ends_on ? ` até ${rule.ends_on.slice(0, 7)}` : ""} ·{" "}
                      {rule.archived_at ? "Arquivada" : rule.is_active ? "Ativa" : "Pausada"}
                      {rule.rule_type !== "fixed_monthly" &&
                        ` · ${rule.include_brl ? "BRL" : ""}${rule.include_brl && rule.include_eur ? "/" : ""}${rule.include_eur ? "EUR" : ""}`}
                      {rule.rule_type === "service_percent" &&
                        ` · ${rule.service_ids.length} serviço(s)`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!rule.archived_at}
                      onClick={() => openRule(rule)}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!rule.archived_at}
                      onClick={() =>
                        actionMutation.mutate({
                          kind: "rule",
                          id: rule.id,
                          active: !rule.is_active,
                        })
                      }
                    >
                      {rule.is_active ? "Pausar" : "Reativar"}
                    </Button>
                    {!rule.archived_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("Arquivar regra e interromper novas projeções?"))
                            actionMutation.mutate({ kind: "archiveRule", id: rule.id });
                        }}
                      >
                        Arquivar
                      </Button>
                    )}
                    {!rule.ends_on && !rule.archived_at && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => actionMutation.mutate({ kind: "end", id: rule.id })}
                      >
                        Encerrar
                      </Button>
                    )}
                  </div>
                </div>
                {rule.rule_type === "fixed_monthly" && (
                  <p className="mt-2 text-admin-ink-muted">
                    {money(rule.amount_cents ?? 0, rule.currency ?? "BRL")} · dia{" "}
                    {rule.day_of_month}
                  </p>
                )}
                {projections.map((projection) => {
                  const payout = projection.payout_id ? payoutMap.get(projection.payout_id) : null;
                  const transaction = payout?.finance_transaction_id
                    ? txMap.get(payout.finance_transaction_id)
                    : null;
                  return (
                    <div
                      key={projection.currency}
                      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-2"
                    >
                      <span>
                        {projection.currency}: base{" "}
                        {money(
                          payout?.base_amount_cents ?? projection.base_amount_cents,
                          projection.currency,
                        )}{" "}
                        × {payout?.percentage ?? projection.percentage}% ={" "}
                        <strong>
                          {money(
                            payout?.amount_cents ?? projection.projected_amount_cents,
                            projection.currency,
                          )}
                        </strong>
                      </span>
                      {!payout && (
                        <Button
                          size="sm"
                          disabled={actionMutation.isPending}
                          onClick={() =>
                            actionMutation.mutate({
                              kind: "materialize",
                              id: rule.id,
                              currency: projection.currency,
                            })
                          }
                        >
                          Gerar repasse
                        </Button>
                      )}
                      {transaction && (
                        <span className="text-admin-ink-muted">
                          {transaction.status === "paid"
                            ? `Pago ${money(transaction.settled_amount_cents ?? payout?.amount_cents ?? 0, transaction.settled_currency ?? projection.currency)}`
                            : "A pagar"}
                        </span>
                      )}
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <SettleTransactionPopover
                            transaction={transaction}
                            accounts={accounts}
                            settle={(input) => settle({ data: input })}
                            createAccount={async (name, currency) =>
                              (await createAccount({ data: { name, type: "bank", currency } })).id
                            }
                            onDone={changed}
                          />
                        )}
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => actOnTransaction(transaction.id, "delete")}
                          >
                            Excluir repasse
                          </Button>
                        )}
                      {transaction?.status === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => actOnTransaction(transaction.id, "reverse")}
                        >
                          Estornar baixa
                        </Button>
                      )}
                    </div>
                  );
                })}
                {historicalPayouts.map((payout) => {
                  const transaction = payout.finance_transaction_id
                    ? txMap.get(payout.finance_transaction_id)
                    : null;
                  return (
                    <div
                      key={payout.id}
                      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-2"
                    >
                      <span>
                        {payout.currency}: base {money(payout.base_amount_cents, payout.currency)} ×{" "}
                        {payout.percentage}% ={" "}
                        <strong>{money(payout.amount_cents, payout.currency)}</strong> (snapshot)
                      </span>
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <SettleTransactionPopover
                            transaction={transaction}
                            accounts={accounts}
                            settle={(input) => settle({ data: input })}
                            createAccount={async (name, currency) =>
                              (await createAccount({ data: { name, type: "bank", currency } })).id
                            }
                            onDone={changed}
                          />
                        )}
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => actOnTransaction(transaction.id, "delete")}
                          >
                            Excluir repasse
                          </Button>
                        )}
                      {transaction?.status === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => actOnTransaction(transaction.id, "reverse")}
                        >
                          Estornar baixa
                        </Button>
                      )}
                    </div>
                  );
                })}
                {fixedPayouts.map((payout) => {
                  const transaction = payout.finance_transaction_id
                    ? txMap.get(payout.finance_transaction_id)
                    : null;
                  return (
                    <div
                      key={payout.id}
                      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-admin-border pt-2"
                    >
                      <span>
                        {transaction?.status === "paid"
                          ? money(
                              transaction.settled_amount_cents ?? payout.amount_cents,
                              transaction.settled_currency ?? payout.currency,
                            )
                          : money(payout.amount_cents, payout.currency)}{" "}
                        · {transaction?.status === "paid" ? "Pago" : "A pagar"}
                        {transaction ? ` · vence ${transaction.due_date}` : ""}
                      </span>
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <SettleTransactionPopover
                            transaction={transaction}
                            accounts={accounts}
                            settle={(input) => settle({ data: input })}
                            createAccount={async (name, currency) =>
                              (await createAccount({ data: { name, type: "bank", currency } })).id
                            }
                            onDone={changed}
                          />
                        )}
                      {transaction &&
                        !["paid", "received", "canceled"].includes(transaction.status) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => actOnTransaction(transaction.id, "delete")}
                          >
                            Excluir repasse
                          </Button>
                        )}
                      {transaction?.status === "paid" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => actOnTransaction(transaction.id, "reverse")}
                        >
                          Estornar baixa
                        </Button>
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </BentoCard>

      <Dialog open={payeeOpen} onOpenChange={setPayeeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingPayee ? "Editar beneficiário" : "Novo beneficiário"}</DialogTitle>
          </DialogHeader>
          <form
            key={editingPayee?.id ?? "new"}
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              payeeMutation.mutate(new FormData(event.currentTarget));
            }}
          >
            <div>
              <Label>Nome</Label>
              <Input name="name" defaultValue={editingPayee?.name ?? ""} required />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={payeeType} onValueChange={(value) => setPayeeType(value as PayeeType)}>
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
              <Label>Vincular a membro (opcional)</Label>
              <Input
                value={profileQuery}
                onChange={(e) => setProfileQuery(e.target.value)}
                placeholder="Buscar nome, e-mail ou telefone"
              />
              {profileId && (
                <div className="mt-1 text-xs text-admin-ink-muted">
                  Perfil selecionado: {profileId}{" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setProfileId(null)}
                  >
                    Desvincular
                  </Button>
                </div>
              )}
              {profileQ.data && profileQuery.trim().length >= 2 && (
                <div className="mt-1 max-h-36 overflow-y-auto rounded border border-admin-border">
                  {profileQ.data.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className="block w-full p-2 text-left text-xs hover:bg-admin-bg"
                      onClick={() => {
                        setProfileId(profile.id);
                        setProfileQuery(
                          `${profile.full_name ?? "Sem nome"} · ${profile.email ?? profile.phone ?? ""}`,
                        );
                      }}
                    >
                      {profile.full_name ?? "Sem nome"} · {profile.email ?? profile.phone ?? ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea name="notes" defaultValue={editingPayee?.notes ?? ""} />
            </div>
            <Button type="submit" disabled={payeeMutation.isPending}>
              Salvar beneficiário
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={ruleOpen} onOpenChange={setRuleOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRule ? "Editar regra" : "Nova regra"}</DialogTitle>
          </DialogHeader>
          <form
            key={editingRule?.id ?? "new"}
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              ruleMutation.mutate(new FormData(event.currentTarget));
            }}
          >
            <div>
              <Label>Beneficiário</Label>
              <Select value={rulePayeeId} onValueChange={setRulePayeeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {data?.payees
                    .filter((payee) => payee.is_active || payee.id === rulePayeeId)
                    .map((payee) => (
                      <SelectItem key={payee.id} value={payee.id}>
                        {payee.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de regra</Label>
              <Select value={ruleType} onValueChange={(value) => setRuleType(value as RuleType)}>
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
            {ruleType === "fixed_monthly" ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Valor</Label>
                  <Input
                    name="amount"
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={
                      editingRule?.amount_cents != null ? editingRule.amount_cents / 100 : ""
                    }
                    required
                  />
                </div>
                <div>
                  <Label>Moeda</Label>
                  <Select
                    value={ruleCurrency}
                    onValueChange={(value) => setRuleCurrency(value as Currency)}
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
                    name="dayOfMonth"
                    type="number"
                    min="1"
                    max="31"
                    defaultValue={editingRule?.day_of_month ?? 1}
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label>Percentual</Label>
                  <Input
                    name="percentage"
                    type="number"
                    min="0.0001"
                    max="100"
                    step="0.0001"
                    defaultValue={editingRule?.percentage ?? ""}
                    required
                  />
                </div>
                <div className="flex gap-4 text-sm">
                  <span>Recebe sobre:</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={includeBrl}
                      onChange={(e) => setIncludeBrl(e.target.checked)}
                    />
                    BRL
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={includeEur}
                      onChange={(e) => setIncludeEur(e.target.checked)}
                    />
                    EUR
                  </label>
                </div>
              </div>
            )}
            {ruleType === "service_percent" && (
              <div>
                <Label>Serviços ({serviceIds.length} selecionado(s))</Label>
                <Input
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
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
                          checked={serviceIds.includes(service.id)}
                          onChange={(e) =>
                            setServiceIds((ids) =>
                              e.target.checked
                                ? [...ids, service.id]
                                : ids.filter((id) => id !== service.id),
                            )
                          }
                        />
                        {service.title}
                      </label>
                    ))}
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Início</Label>
                <Input
                  name="startsOn"
                  type="date"
                  defaultValue={editingRule?.starts_on ?? monthStart(month)}
                  required
                />
              </div>
              <div>
                <Label>Fim (opcional)</Label>
                <Input name="endsOn" type="date" defaultValue={editingRule?.ends_on ?? ""} />
              </div>
            </div>
            <p className="text-xs text-admin-ink-muted">
              Use o primeiro dia do mês. Alterações afetam apenas meses ainda não gerados.
            </p>
            <Button
              type="submit"
              disabled={
                ruleMutation.isPending ||
                !rulePayeeId ||
                (ruleType !== "fixed_monthly" && !includeBrl && !includeEur) ||
                (ruleType === "service_percent" && !serviceIds.length)
              }
            >
              Salvar regra
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
