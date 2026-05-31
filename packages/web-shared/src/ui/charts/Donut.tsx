export interface DonutDatum {
  [key: string]: number | string;
}

export interface DonutProps {
  data: DonutDatum[];
  valueKey?: string;
  size?: number;
  thickness?: number;
}

const DONUT_COLORS = [
  "var(--accent)",
  "color-mix(in oklab, var(--accent) 64%, var(--surface))",
  "color-mix(in oklab, var(--accent) 36%, var(--surface))",
  "color-mix(in oklab, var(--ink) 30%, var(--surface))",
];

export function Donut({
  data,
  valueKey = "cents",
  size = 150,
  thickness = 18,
}: DonutProps) {
  const total = data.reduce((a, d) => a + (d[valueKey] as number), 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ transform: "rotate(-90deg)" }}
    >
      {data.map((d, i) => {
        const frac = (d[valueKey] as number) / total;
        const dash = frac * c;
        const seg = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={DONUT_COLORS[i % DONUT_COLORS.length]}
            strokeWidth={thickness}
            strokeDasharray={`${dash} ${c - dash}`}
            strokeDashoffset={-acc * c}
            strokeLinecap="butt"
          />
        );
        acc += frac;
        return seg;
      })}
    </svg>
  );
}
