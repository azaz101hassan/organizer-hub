import type { ReactNode } from "react";

export type BadgeTone = "owner" | "admin" | "member" | "published" | "draft" | "cancelled";
export type BadgeProps = { tone?: BadgeTone; children: ReactNode; className?: string };

export function Badge({ tone = "member", children, className = "" }: BadgeProps) {
  return (
    <span className={["badge", `badge--${tone}`, className].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}
