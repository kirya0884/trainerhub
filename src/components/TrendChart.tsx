import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface TrendChartProps {
  data: { date: string; value: number }[];
  color: string;
  height?: number;
  formatter: (v: number) => string;
  domain?: [string | number, string | number];
  emptyText?: string;
}

export default function TrendChart({ data, color, height = 220, formatter, domain = ["auto", "auto"], emptyText = "Нет данных." }: TrendChartProps) {
  if (data.length === 0) return <p className="text-sm text-zinc-600 text-center py-10">{emptyText}</p>;
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 5, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
          <XAxis dataKey="date" stroke="#71717a" fontSize={11} tickLine={false} />
          <YAxis stroke="#71717a" fontSize={11} tickLine={false} width={36} domain={domain} />
          <Tooltip contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }} labelStyle={{ color: "#a1a1aa" }} formatter={(v: any) => [formatter(v), ""]} />
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} dot={{ r: 3, fill: color }} activeDot={{ r: 5 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
