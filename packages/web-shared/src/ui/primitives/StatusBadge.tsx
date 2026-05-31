import { Badge } from "./Badge";

const LABEL = { PUBLISHED: "Published", DRAFT: "Draft", CANCELLED: "Cancelled" } as const;
const TONE = { PUBLISHED: "published", DRAFT: "draft", CANCELLED: "cancelled" } as const;

export type StatusBadgeProps = { status: keyof typeof LABEL };

export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
