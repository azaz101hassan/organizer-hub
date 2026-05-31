import type { ReactNode } from "react";

export interface FeedItemProps {
  icon: ReactNode;
  iconBg?: string;
  iconColor?: string;
  who: string;
  what: string;
  when: string;
  amount?: string;
}

export function FeedItem({
  icon,
  iconBg = "var(--accent-soft)",
  iconColor = "var(--accent)",
  who,
  what,
  when,
  amount,
}: FeedItemProps) {
  return (
    <div className="feed__item">
      <span
        className="feed__ic"
        style={{ background: iconBg, color: iconColor }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.35 }}>
          <span style={{ fontWeight: 600 }}>{who}</span>{" "}
          <span style={{ color: "var(--muted)" }}>{what}</span>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--faint)", marginTop: 3 }}>
          {when}
        </div>
      </div>
      {amount && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--ink)",
            flexShrink: 0,
          }}
        >
          {amount}
        </div>
      )}
    </div>
  );
}
