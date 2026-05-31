import { Icon } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../components/PageHead";

export default function AdminDashboardPage() {
  return (
    <PageHead
      crumb={
        <>
          <Icon name="home" size={13} /> OrganizerHub{" "}
          <Icon name="chevR" size={12} /> Dashboard
        </>
      }
      title="Dashboard"
      sub="KPI cards, charts, and activity feed land in the next unit."
    />
  );
}
