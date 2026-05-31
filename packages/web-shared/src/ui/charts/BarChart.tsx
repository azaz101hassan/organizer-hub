"use client";

import { useState } from "react";

export interface BarDatum {
  month: string;
  [key: string]: number | string;
}

export interface BarChartProps {
  data: BarDatum[];
  valueKey?: string;
  fmt?: (value: number) => string;
}

function moneyK(cents: number): string {
  const v = cents / 100;
  if (v >= 1000) return "$" + (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k";
  return "$" + v.toFixed(0);
}

export function BarChart({
  data,
  valueKey = "cents",
  fmt = moneyK,
}: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d[valueKey] as number));

  return (
    <div>
      <div className="bars">
        {data.map((d, i) => {
          const val = d[valueKey] as number;
          const h = Math.max(4, (val / (max || 1)) * 100);
          return (
            <div
              className="bars__col"
              key={d.month || i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "flex-end",
                  height: "100%",
                }}
              >
                {hover === i && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: `calc(${h}% + 8px)`,
                      background: "var(--ink)",
                      color: "var(--bg)",
                      fontSize: 11.5,
                      fontWeight: 700,
                      padding: "4px 9px",
                      borderRadius: 5,
                      whiteSpace: "nowrap",
                      zIndex: 2,
                    }}
                  >
                    {fmt(val)}
                  </div>
                )}
                <div
                  className="bars__bar"
                  style={{
                    height: `${h}%`,
                    opacity: hover == null || hover === i ? 1 : 0.5,
                  }}
                />
              </div>
              <span className="bars__lbl">{d.month}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
