import { ICON_PATHS, type IconName } from "./paths";

export type { IconName };

export type IconProps = { name: IconName; size?: number; className?: string };

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: "block" }}
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
