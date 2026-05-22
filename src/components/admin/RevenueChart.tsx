import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function RevenueChart({ data }: { data: { date: string; value: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="oklch(0.58 0.18 45)" stopOpacity={0.4} />
              <stop offset="100%" stopColor="oklch(0.58 0.18 45)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={(v) => v.slice(5)} fontSize={10} stroke="oklch(0.62 0.025 50)" tickLine={false} axisLine={false} />
          <YAxis fontSize={10} stroke="oklch(0.62 0.025 50)" tickLine={false} axisLine={false} width={40} />
          <Tooltip
            contentStyle={{ background: "white", border: "1px solid oklch(0.91 0.008 70)", borderRadius: 12, fontSize: 12 }}
            formatter={(v) => [`€ ${Number(v).toFixed(2)}`, "Receita"]}
            labelFormatter={(l) => l}
          />
          <Area type="monotone" dataKey="value" stroke="oklch(0.58 0.18 45)" strokeWidth={2} fill="url(#rev)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
