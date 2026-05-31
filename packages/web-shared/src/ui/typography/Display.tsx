import type { HTMLAttributes, ReactNode } from "react";

export type DisplayProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: "h1" | "h2" | "h3" | "h4";
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
};

const SIZE = {
  sm: "fontSize:22px",
  md: "fontSize:30px",
  lg: "fontSize:38px",
  xl: "fontSize:48px",
} as const;

export function Display({
  as: Tag = "h1",
  size = "md",
  className = "",
  style,
  children,
  ...rest
}: DisplayProps) {
  const cls = ["display", className].filter(Boolean).join(" ");
  const sizeStyle = SIZE[size].split(":");
  return (
    <Tag
      className={cls}
      style={{ [sizeStyle[0] as string]: sizeStyle[1], ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
}
