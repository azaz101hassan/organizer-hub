import { getHouseOrgId } from "@organizer-hub/web-shared";
import NewEventForm from "./NewEventForm";

export default function NewEventPage() {
  const orgId = getHouseOrgId();
  return <NewEventForm orgId={orgId} />;
}
