import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@organizer-hub/web-shared";
import { BrandCorner } from "./BrandCorner";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";

export async function AdminShell({ children }: { children: ReactNode }) {
  const session = await readSession({
    session: "oh_admin_session",
    refresh: "oh_admin_refresh",
    accessToken: "oh_admin_access_token",
  });

  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="ad">
      <BrandCorner />
      <TopBar session={session} />
      <Sidebar />
      <main className="ad__main">{children}</main>
    </div>
  );
}
