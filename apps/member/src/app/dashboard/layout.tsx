import type { ReactNode } from "react";
import { DashShell } from "../../components/DashShell";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashShell>{children}</DashShell>;
}
