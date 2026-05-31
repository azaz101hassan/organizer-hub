import type { ReactNode } from "react";
import { PublicNav } from "./PublicNav";
import { PublicFooter } from "./PublicFooter";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="scene">
      <PublicNav />
      {children}
      <PublicFooter />
    </div>
  );
}
