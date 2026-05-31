import type { HTMLAttributes, ReactNode } from "react";

export type EyebrowProps = HTMLAttributes<HTMLParagraphElement> & {
  muted?: boolean;
  children: ReactNode;
};

export function Eyebrow({
  muted = false,
  className = "",
  children,
  ...rest
}: EyebrowProps) {
  const cls = ["eyebrow", muted ? "eyebrow--muted" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <p className={cls} {...rest}>
      {children}
    </p>
  );
}
