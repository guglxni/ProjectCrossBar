import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { formatUsd, type PricePoint } from "@/lib/coingecko";

interface Props {
  data: PricePoint[];
  /** true → green gradient (up on the day), false → red. */
  up: boolean;
  /** Unique per asset so Recharts remounts and SVG defs do not collide. */
  chartKey: string;
  className?: string;
}

const config = {
  price: { label: "Price", color: "var(--accent)" },
} satisfies ChartConfig;

/**
 * Intraday price area chart, styled after the shadcn area chart
 * (https://ui.shadcn.com/charts/area): smooth area, vertical-free grid,
 * gradient fill, time x-axis, USD y-axis. Color follows the day's direction.
 */
export function LivePriceChart({ data, up, chartKey, className }: Props) {
  const stroke = up ? "var(--success)" : "var(--destructive)";
  const fillId = `fillLivePrice-${chartKey}`;
  const points = data.map((p) => ({ t: p.t, price: p.price }));

  if (points.length === 0) {
    return (
      <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">
        Loading live price…
      </div>
    );
  }

  return (
    <ChartContainer config={config} className={className ?? "h-[280px] w-full"}>
      <AreaChart data={points} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="95%" stopColor={stroke} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="t"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={48}
          fontSize={11}
          tickFormatter={(t: number) =>
            new Date(t).toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })
          }
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          fontSize={11}
          domain={["dataMin", "dataMax"]}
          tickFormatter={(v: number) => formatUsd(v)}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => {
                const t = p?.[0]?.payload?.t as number | undefined;
                return t
                  ? new Date(t).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
              }}
              formatter={(value) => formatUsd(Number(value))}
            />
          }
        />
        <Area
          dataKey="price"
          type="natural"
          stroke={stroke}
          strokeWidth={2}
          fill={`url(#${fillId})`}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
