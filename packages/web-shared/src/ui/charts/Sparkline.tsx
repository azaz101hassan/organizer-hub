export interface SparklineProps {
  values: number[];
  w?: number;
  h?: number;
  up?: boolean;
}

export function Sparkline({ values, w = 92, h = 30, up = true }: SparklineProps) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${(i / (values.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`,
    )
    .join(" ");
  const col = up ? "var(--good)" : "var(--bad)";

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ overflow: "visible" }}
    >
      <polyline
        points={pts}
        fill="none"
        stroke={col}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
