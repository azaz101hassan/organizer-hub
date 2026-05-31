import { readThemeCookie } from "@organizer-hub/web-shared/ui/theme";
import { PageHead } from "../../components/PageHead";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const theme = await readThemeCookie("oh_admin_theme", "noir");
  return (
    <>
      <PageHead
        title="Settings"
        sub="Manage your organization, team, and billing."
      />
      <SettingsClient currentTheme={theme} />
    </>
  );
}
