import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "solid" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block = false, className = "", children, ...rest },
  ref,
) {
  const cls = [
    "btn",
    `btn--${variant}`,
    size === "sm" ? "btn--sm" : size === "lg" ? "btn--lg" : "",
    block ? "btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
});
