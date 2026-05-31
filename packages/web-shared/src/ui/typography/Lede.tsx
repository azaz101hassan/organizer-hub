import type { HTMLAttributes, ReactNode } from "react";

export function Lede({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) {
  return (
    <p className={["lede", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </p>
  );
}
