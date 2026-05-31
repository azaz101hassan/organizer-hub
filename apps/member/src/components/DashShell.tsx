import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@organizer-hub/web-shared";
import { DashSidebar } from "./DashSidebar";

export async function DashShell({ children }: { children: ReactNode }) {
  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  if (!session) redirect("/auth/login");
  return (
    <div className="dash">
      <DashSidebar session={session} />
      <main className="dash__main fade-in">{children}</main>
    </div>
  );
}
