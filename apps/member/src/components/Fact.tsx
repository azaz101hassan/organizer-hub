import type { ReactNode } from "react";
import { Eyebrow, Icon, type IconName } from "@organizer-hub/web-shared/ui";

export function Fact({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          color: "var(--faint)",
          marginBottom: 7,
        }}
      >
        <Icon name={icon} size={15} />
        <Eyebrow muted>{label}</Eyebrow>
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 500 }}>{children}</div>
    </div>
  );
}
