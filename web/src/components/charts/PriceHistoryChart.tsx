import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { PRICE_SCALE } from "@/lib/constants";

interface Props {
  data: { window: number; clearingPrice: number }[];
  className?: string;
}

const config = {
  price: { label: "Clearing price p*", color: "#7a3fb5" },
} satisfies ChartConfig;

export function PriceHistoryChart({ data, className }: Props) {
  const points = data.map((d) => ({
    window: d.window,
    price: d.clearingPrice / PRICE_SCALE,
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        No cleared windows yet
      </div>
    );
  }

  return (
    <ChartContainer config={config} className={className ?? "h-[240px] w-full"}>
      <AreaChart data={points} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillPrice" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-price)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-price)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="window"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          fontSize={11}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          fontSize={11}
          tickFormatter={(v: number) =>
            v.toLocaleString(undefined, { maximumFractionDigits: 4 })
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) =>
                `Window ${p?.[0]?.payload?.window ?? ""}`
              }
            />
          }
        />
        <Area
          dataKey="price"
          type="monotone"
          stroke="var(--color-price)"
          strokeWidth={2}
          fill="url(#fillPrice)"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ChartContainer>
  );
}
