import type { MouseEventHandler, ReactNode } from "react";

export type ChipProps = {
  children: ReactNode;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
};

export function Chip({ children, active = false, onClick, className = "" }: ChipProps) {
  const cls = ["chip", active ? "chip--active" : "", className].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick}>
        {children}
      </button>
    );
  }
  return <span className={cls}>{children}</span>;
}
