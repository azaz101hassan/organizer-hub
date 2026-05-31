import { Card, Icon, type IconName } from "@organizer-hub/web-shared/ui";

export function StatCard({
  num,
  label,
  icon,
  accent = false,
}: {
  num: string | number;
  label: string;
  icon: IconName;
  accent?: boolean;
}) {
  return (
    <Card style={{ padding: "20px 22px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div
          className="stat__num"
          style={{ color: accent ? "var(--accent)" : "var(--ink)" }}
        >
          {num}
        </div>
        <span style={{ color: accent ? "var(--accent)" : "var(--faint)" }}>
          <Icon name={icon} size={20} />
        </span>
      </div>
      <div className="stat__label">{label}</div>
    </Card>
  );
}
