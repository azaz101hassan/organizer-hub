import { redirect } from "next/navigation";
import {
  ApiError,
  apiFetch,
  UnauthorizedError,
  getHouseOrgId,
} from "@organizer-hub/web-shared";
import type { EventLabelView } from "@organizer-hub/web-shared";
import LabelsManager from "./LabelsManager";

export default async function LabelsPage() {
  const orgId = getHouseOrgId();
  let labels: EventLabelView[];
  try {
    labels = await apiFetch<EventLabelView[]>(
      `/organizations/${orgId}/event-labels`,
    );
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/auth/login");
    if (err instanceof ApiError && err.status === 404) {
      labels = [];
    } else {
      throw err;
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Labels
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Tag events so visitors can filter by category. Slugs are URL-safe and
          unique per organization.
        </p>
      </div>
      <LabelsManager labels={labels} />
    </div>
  );
}
