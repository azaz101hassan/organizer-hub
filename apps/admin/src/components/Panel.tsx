import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, action, children }: PanelProps) {
  return (
    <div className="panel">
      <div className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {action && <div>{action}</div>}
      </div>
      <div className="panel__body">{children}</div>
    </div>
  );
}
