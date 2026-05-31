import type { ReactNode } from "react";
import { Display } from "@organizer-hub/web-shared/ui";

interface PageHeadProps {
  crumb?: ReactNode;
  title: string;
  sub?: string;
  actions?: ReactNode;
}

export function PageHead({ crumb, title, sub, actions }: PageHeadProps) {
  return (
    <div className="ad__head">
      <div>
        {crumb && <div className="ad__crumb">{crumb}</div>}
        <Display as="h1" style={{ fontSize: 30 }}>
          {title}
        </Display>
        {sub && (
          <p className="muted" style={{ fontSize: 14, marginTop: 7 }}>
            {sub}
          </p>
        )}
      </div>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
