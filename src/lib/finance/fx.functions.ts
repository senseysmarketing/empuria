import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireStaff } from "@/lib/admin/auth";

type PtaxRow = {
  cotacaoVenda?: number;
  dataHoraCotacao?: string;
  tipoBoletim?: string;
};

function ptaxDate(date: Date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

export async function fetchEurBrlReferenceRate(date?: string) {
  const requested = date ? new Date(`${date}T23:59:59.999Z`) : new Date();
  if (Number.isNaN(requested.getTime())) throw new Error("Data inválida para consulta PTAX.");
  const start = new Date(requested);
  start.setUTCDate(start.getUTCDate() - 10);
  const params = new URLSearchParams({
    "@moeda": "'EUR'",
    "@dataInicial": `'${ptaxDate(start)}'`,
    "@dataFinalCotacao": `'${ptaxDate(requested)}'`,
    $format: "json",
    $select: "cotacaoVenda,dataHoraCotacao,tipoBoletim",
    $orderby: "dataHoraCotacao desc",
  });
  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    `CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${params}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`BCB respondeu ${response.status}`);
    const payload = (await response.json()) as { value?: PtaxRow[] };
    const rows = (payload.value ?? []).filter(
      (row) => Number.isFinite(row.cotacaoVenda) && row.dataHoraCotacao,
    );
    const row = rows.find((item) => item.tipoBoletim === "Fechamento") ?? rows[0];
    if (!row?.cotacaoVenda || !row.dataHoraCotacao) throw new Error("Sem PTAX disponível.");
    return {
      rate: Number(row.cotacaoVenda),
      date: row.dataHoraCotacao.slice(0, 10),
      source: "BCB_PTAX" as const,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export const getEurBrlReferenceRate = createServerFn({ method: "POST" })
  .middleware([requireStaff])
  .inputValidator((input) =>
    z
      .object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    try {
      return { ok: true as const, ...(await fetchEurBrlReferenceRate(data.date)) };
    } catch (error) {
      return {
        ok: false as const,
        rate: null,
        date: data.date ?? new Date().toISOString().slice(0, 10),
        source: "MANUAL" as const,
        message: error instanceof Error ? error.message : "PTAX indisponível.",
      };
    }
  });
