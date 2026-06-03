import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession, donationsEnabledForOrg } from "@organizer-hub/web-shared";
import { readThemeCookie } from "@organizer-hub/web-shared/ui/theme/server";
import { DashSidebar } from "./DashSidebar";

export async function DashShell({ children }: { children: ReactNode }) {
  const [session, theme, donationsEnabled] = await Promise.all([
    readSession({
      session: "oh_member_session",
      refresh: "oh_member_refresh",
      accessToken: "oh_member_access_token",
    }),
    readThemeCookie("oh_member_theme", "atrium"),
    donationsEnabledForOrg(),
  ]);
  if (!session) redirect("/auth/login");
  return (
    <div className="dash">
      <DashSidebar
        session={session}
        currentTheme={theme}
        donationsEnabled={donationsEnabled}
      />
      <main className="dash__main fade-in">{children}</main>
    </div>
  );
}
