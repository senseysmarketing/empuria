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
  saveFinanceTeamMember,
  searchFinancePayeeProfiles,
  setFinanceTeamMemberState,
  type FinancePayee,
  type FinancePayoutRule,
  type FinanceTeamMember,
} from "@/lib/admin/finance-team.functions";

type Currency = "BRL" | "EUR";
type RuleType = FinancePayoutRule["rule_type"];
type FormValues = {
  name: string;
  type: FinancePayee["type"];
  profileId: string | null;
  notes: string | null;
  ruleType: RuleType;
  amountCents: number | null;
  currency: Currency | null;
  percentage: number | null;
  includeBrl: boolean;
  includeEur: boolean;
  dayOfMonth: number | null;
  serviceIds: string[];
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
  revenue_percent: "% da receita realizada",
  service_percent: "% dos serviços selecionados",
};
const EMPTY_FORM: FormValues = {
  name: "",
  type: "team",
  profileId: null,
  notes: null,
  ruleType: "fixed_monthly",
  amountCents: null,
  currency: "BRL",
  percentage: null,
  includeBrl: true,
  includeEur: true,
  dayOfMonth: 1,
  serviceIds: [],
};

function money(cents: number, currency: string) {
  return new Intl.NumberFormat(currency === "EUR" ? "pt-PT" : "pt-BR", {
    style: "currency",
    currency,
  }).format(cents / 100);
}

function ruleDescription(rule: FinancePayoutRule | null) {
  if (!rule) return "Sem configuração ativa neste mês";
  if (rule.rule_type === "fixed_monthly")
    return `${RULE_TYPES[rule.rule_type]} · ${money(rule.amount_cents ?? 0, rule.currency ?? "BRL")} · dia ${rule.day_of_month}`;
  const currencies = [rule.include_brl && "BRL", rule.include_eur && "EUR"]
    .filter(Boolean)
    .join(" / ");
  return `${RULE_TYPES[rule.rule_type]} · ${rule.percentage}% · ${currencies}${rule.rule_type === "service_percent" ? ` · ${rule.service_ids.length} serviço(s)` : ""}`;
}

function financialChanged(values: FormValues, rule: FinancePayoutRule | null) {
  if (!rule) return true;
  return (
    values.ruleType !== rule.rule_type ||
    (values.ruleType === "fixed_monthly"
      ? values.amountCents !== rule.amount_cents ||
        values.currency !== rule.currency ||
        values.dayOfMonth !== rule.day_of_month
      : values.percentage !== rule.percentage ||
        values.includeBrl !== rule.include_brl ||
        values.includeEur !== rule.include_eur ||
        (values.ruleType === "service_percent" &&
          [...values.serviceIds].sort().join() !== [...rule.service_ids].sort().join()))
  );
}

export function FinanceTeamPanel({ month, onChanged }: { month: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const list = useServerFn(listFinanceTeamMonth);
  const save = useServerFn(saveFinanceTeamMember);
  const setState = useServerFn(setFinanceTeamMemberState);
  const searchProfiles = useServerFn(searchFinancePayeeProfiles);
  const settle = useServerFn(settleFinanceTransaction);
  const reverse = useServerFn(reverseFinanceSettlement);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<FinanceTeamMember | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [profileQuery, setProfileQuery] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
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
  const profileQ = useQuery({
    queryKey: ["finance-payee-profiles", profileQuery],
    queryFn: () => searchProfiles({ data: { query: profileQuery.trim() } }),
    enabled: formOpen && profileQuery.trim().length >= 2,
  });
  const changed = () => {
    qc.invalidateQueries({ queryKey: ["finance-team"] });
    onChanged();
  };
  const saveMutation = useMutation({
    mutationFn: (choice: { mode: "current" | "next_month"; reversePaid: boolean }) =>
      save({
        data: {
          payeeId: editing?.payee.id ?? null,
          month: `${month}-01`,
          ...choice,
          ...form,
        },
      }),
    onSuccess: () => {
      toast.success("Pessoa e repasse salvos");
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

  function openForm(member: FinanceTeamMember | null) {
    const payee = member?.payee;
    const rule = member?.rule;
    setEditing(member);
    setForm({
      name: payee?.name ?? "",
      type: payee?.type ?? "team",
      profileId: payee?.profile_id ?? null,
      notes: payee?.notes ?? null,
      ruleType: rule?.rule_type ?? "fixed_monthly",
      amountCents: rule?.amount_cents ?? null,
      currency: (rule?.currency as Currency) ?? "BRL",
      percentage: rule?.percentage ?? null,
      includeBrl: rule?.include_brl ?? true,
      includeEur: rule?.include_eur ?? true,
      dayOfMonth: rule?.day_of_month ?? 1,
      serviceIds: rule?.service_ids ?? [],
    });
    setProfileQuery("");
    setServiceSearch("");
    setFormOpen(true);
  }

  const hasPaid = !!editing?.payouts.some(({ transaction }) => transaction?.status === "paid");
  const valid =
    form.name.trim().length >= 2 &&
    (form.ruleType === "fixed_monthly"
      ? form.amountCents !== null && form.amountCents >= 0 && !!form.currency && !!form.dayOfMonth
      : !!form.percentage &&
        (form.includeBrl || form.includeEur) &&
        (form.ruleType !== "service_percent" || form.serviceIds.length > 0));
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
            const { payee, rule } = member;
            return (
              <section key={payee.id} className="rounded-lg border border-admin-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <strong>{payee.name}</strong>
                    <div className="text-admin-ink-muted">
                      {PAYEE_TYPES[payee.type]} ·{" "}
                      {payee.archived_at ? "Removido" : payee.is_active ? "Ativo" : "Pausado"}
                    </div>
                    <div className="text-admin-ink-muted">{ruleDescription(rule)}</div>
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
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar pessoa e repasse" : "Adicionar pessoa e repasse"}
            </DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              if (editing && financialChanged(form, editing.rule)) setDecisionOpen(true);
              else saveMutation.mutate({ mode: "current", reversePaid: false });
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
              <Label>Vincular a perfil (opcional)</Label>
              <Input
                value={profileQuery}
                onChange={(event) => setProfileQuery(event.target.value)}
                placeholder="Buscar nome, e-mail ou telefone"
              />
              {form.profileId && (
                <div className="mt-1 text-xs text-admin-ink-muted">
                  Perfil selecionado ·{" "}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setForm({ ...form, profileId: null })}
                  >
                    Desvincular
                  </Button>
                </div>
              )}
              {profileQ.data && profileQuery.trim().length >= 2 && (
                <div className="mt-1 max-h-32 overflow-y-auto rounded border border-admin-border">
                  {profileQ.data.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      className="block w-full p-2 text-left text-xs hover:bg-admin-bg"
                      onClick={() => {
                        setForm({ ...form, profileId: profile.id });
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
              <Textarea
                value={form.notes ?? ""}
                onChange={(event) => setForm({ ...form, notes: event.target.value || null })}
              />
            </div>
            <div>
              <Label>Forma de receber</Label>
              <Select
                value={form.ruleType}
                onValueChange={(value) => setForm({ ...form, ruleType: value as RuleType })}
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
            {form.ruleType === "fixed_monthly" ? (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Valor</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.amountCents === null ? "" : form.amountCents / 100}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        amountCents:
                          event.target.value === ""
                            ? null
                            : Math.round(Number(event.target.value) * 100),
                      })
                    }
                    required
                  />
                </div>
                <div>
                  <Label>Moeda</Label>
                  <Select
                    value={form.currency ?? "BRL"}
                    onValueChange={(value) => setForm({ ...form, currency: value as Currency })}
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
                    value={form.dayOfMonth ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        dayOfMonth: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    required
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label>Percentual</Label>
                  <Input
                    type="number"
                    min="0.0001"
                    max="100"
                    step="0.0001"
                    value={form.percentage ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        percentage: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    required
                  />
                </div>
                <div className="flex gap-4 text-sm">
                  <span>Recebe sobre:</span>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.includeBrl}
                      onChange={(event) => setForm({ ...form, includeBrl: event.target.checked })}
                    />
                    BRL
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={form.includeEur}
                      onChange={(event) => setForm({ ...form, includeEur: event.target.checked })}
                    />
                    EUR
                  </label>
                </div>
              </div>
            )}
            {form.ruleType === "service_percent" && (
              <div>
                <Label>Serviços ({form.serviceIds.length} selecionado(s))</Label>
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
                          checked={form.serviceIds.includes(service.id)}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              serviceIds: event.target.checked
                                ? [...form.serviceIds, service.id]
                                : form.serviceIds.filter((id) => id !== service.id),
                            })
                          }
                        />
                        {service.title}
                      </label>
                    ))}
                </div>
              </div>
            )}
            <Button type="submit" disabled={!valid || saveMutation.isPending}>
              Salvar
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
              ? "Este mês já possui repasse pago. O valor pago fica congelado, a menos que você o estorne explicitamente."
              : "O repasse pendente deste mês será recalculado sem criar duplicatas."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ mode: "next_month", reversePaid: false })}
            >
              Aplicar a partir do próximo mês
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ mode: "current", reversePaid: hasPaid })}
            >
              {hasPaid ? "Estornar e atualizar mês atual" : "Atualizar mês atual"}
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
