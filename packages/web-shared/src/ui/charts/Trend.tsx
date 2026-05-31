import { Icon } from "../icons/Icon";

export interface TrendProps {
  delta: number;
  suffix?: string;
}

export function Trend({ delta, suffix = "%" }: TrendProps) {
  const up = delta >= 0;
  return (
    <span className={`trend ${up ? "trend--up" : "trend--down"}`}>
      <Icon name={up ? "trendUp" : "trendDown"} size={13} />
      {up ? "+" : ""}
      {delta}
      {suffix}
    </span>
  );
}
