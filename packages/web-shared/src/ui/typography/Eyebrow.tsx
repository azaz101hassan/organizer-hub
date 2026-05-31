import type { ReactNode } from "react";

export function Eyebrow({
  muted = false,
  className = "",
  children,
}: {
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const cls = ["eyebrow", muted ? "eyebrow--muted" : "", className]
    .filter(Boolean)
    .join(" ");
  return <p className={cls}>{children}</p>;
}
