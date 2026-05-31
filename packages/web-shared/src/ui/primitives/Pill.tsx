import type { ReactNode } from "react";

export type PillTone = "paid" | "pending" | "refunded" | "active" | "lapsed";

export function Pill({
  tone,
  children,
  className = "",
}: {
  tone: PillTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={["pill", `pill--${tone}`, className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
