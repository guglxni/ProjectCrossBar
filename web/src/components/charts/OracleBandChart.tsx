import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface Props {
  data: { window: number; pStar: number; low: number; high: number; ref: number }[];
  className?: string;
}

const config = {
  band: { label: "Oracle band", color: "#7a3fb5" },
  pStar: { label: "Clearing price p*", color: "#7a3fb5" },
  ref: { label: "Reference price", color: "#000000" },
} satisfies ChartConfig;

export function OracleBandChart({ data, className }: Props) {
  // Stacked-area technique: a transparent base up to `low`, then the band
  // thickness (high - low) shaded on top.
  const points = data.map((d) => ({
    window: d.window,
    base: d.low,
    band: Math.max(0, d.high - d.low),
    pStar: d.pStar,
    ref: d.ref,
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        Oracle band populates after first clear
      </div>
    );
  }

  return (
    <ChartContainer config={config} className={className ?? "h-[240px] w-full"}>
      <ComposedChart data={points} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
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
          domain={["auto", "auto"]}
          tickFormatter={(v: number) =>
            v.toLocaleString(undefined, { maximumFractionDigits: 4 })
          }
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(_, p) => `Window ${p?.[0]?.payload?.window ?? ""}`}
            />
          }
        />
        <Area
          dataKey="base"
          stackId="band"
          stroke="none"
          fill="transparent"
          isAnimationActive={false}
        />
        <Area
          dataKey="band"
          stackId="band"
          stroke="none"
          fill="var(--color-band)"
          fillOpacity={0.15}
          isAnimationActive={false}
        />
        <Line
          dataKey="ref"
          type="monotone"
          stroke="var(--color-ref)"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          dot={false}
        />
        <Line
          dataKey="pStar"
          type="monotone"
          stroke="var(--color-pStar)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}
