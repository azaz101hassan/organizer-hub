import type { ReactNode } from "react";
import { Icon, type IconName } from "@organizer-hub/web-shared/ui";
import { Sparkline } from "@organizer-hub/web-shared/ui";
import { Trend } from "@organizer-hub/web-shared/ui";

export interface KpiCardProps {
  label: string;
  value: string;
  icon: IconName;
  delta?: number;
  deltaSuffix?: string;
  sparkline?: number[];
  sparklineUp?: boolean;
  children?: ReactNode;
}

export function KpiCard({
  label,
  value,
  icon,
  delta,
  deltaSuffix,
  sparkline,
  sparklineUp = true,
  children,
}: KpiCardProps) {
  return (
    <div className="kpi">
      <div className="kpi__top">
        <span className="kpi__ic">
          <Icon name={icon} size={18} />
        </span>
        {sparkline && sparkline.length > 1 && (
          <Sparkline values={sparkline} up={sparklineUp} />
        )}
      </div>
      <div>
        <div className="kpi__label">{label}</div>
        <div className="kpi__val">{value}</div>
      </div>
      {(delta !== undefined || children) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {delta !== undefined && (
            <Trend delta={delta} suffix={deltaSuffix} />
          )}
          {children}
        </div>
      )}
    </div>
  );
}
