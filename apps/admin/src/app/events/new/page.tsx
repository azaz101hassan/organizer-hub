import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";
import type { EventLabelView } from "@organizer-hub/web-shared";
import NewEventForm from "./NewEventForm";

export default async function NewEventPage() {
  const orgId = getHouseOrgId();
  let labels: EventLabelView[];
  try {
    labels = await apiFetch<EventLabelView[]>(
      `/event-labels?organizationId=${encodeURIComponent(orgId)}`,
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      labels = [];
    } else {
      throw err;
    }
  }
  return <NewEventForm orgId={orgId} labels={labels} />;
}
