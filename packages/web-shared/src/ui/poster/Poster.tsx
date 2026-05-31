import type { CSSProperties, ReactNode } from "react";
import { GRAIN_TEXTURE } from "./grain";
import { MOODS, type Mood } from "./moods";

export type { Mood };

export type PosterProps = {
  mood: Mood;
  label?: string;
  monoSize?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

export function Poster({
  mood,
  label,
  monoSize = 200,
  className = "",
  style,
  children,
}: PosterProps) {
  const m = MOODS[mood];
  const vars: CSSProperties = {
    "--p1": m.p1,
    "--p2": m.p2,
    "--p-ink": m.ink,
    "--grain": GRAIN_TEXTURE,
    ...style,
  } as CSSProperties;
  return (
    <div className={`poster ${className}`} style={vars}>
      <div className="poster__wash" />
      {label != null && (
        <div className="poster__mono" style={{ fontSize: monoSize, padding: "0 0.06em" }}>
          {label}
        </div>
      )}
      {children}
    </div>
  );
}
