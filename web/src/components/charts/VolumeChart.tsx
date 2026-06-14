import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

interface Props {
  data: { window: number; matchedVolume: number }[];
  className?: string;
}

const config = {
  volume: { label: "Matched volume", color: "#2ea043" },
} satisfies ChartConfig;

const nf = new Intl.NumberFormat();

export function VolumeChart({ data, className }: Props) {
  const points = data.map((d) => ({
    window: d.window,
    volume: d.matchedVolume,
  }));

  if (points.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
        No matched volume yet
      </div>
    );
  }

  return (
    <ChartContainer config={config} className={className ?? "h-[240px] w-full"}>
      <BarChart data={points} margin={{ left: 8, right: 12, top: 8, bottom: 0 }}>
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
          tickFormatter={(v: number) => nf.format(v)}
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
        <Bar dataKey="volume" fill="var(--color-volume)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
