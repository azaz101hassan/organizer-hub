import {
  ApiError,
  publicApiFetch,
  getHouseOrgId,
} from "@organizer-hub/web-shared";
import type { PublicEventsPage } from "@organizer-hub/web-shared";
import { Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";
import { EventCard } from "../../components/EventCard";
import { FilterChips } from "../../components/FilterChips";

export const dynamic = "force-dynamic";

interface PublicLabelChip {
  id: string;
  name: string;
  slug: string;
}

async function fetchLabels(): Promise<PublicLabelChip[]> {
  let houseOrgId: string;
  try {
    houseOrgId = getHouseOrgId();
  } catch {
    // Member is still allowed to render /events without HOUSE_ORG_ID set;
    // it just renders without the filter strip in that case.
    return [];
  }
  try {
    return await publicApiFetch<PublicLabelChip[]>(
      `/public/event-labels?organizationId=${encodeURIComponent(houseOrgId)}`,
    );
  } catch {
    return [];
  }
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string; labelId?: string }>;
}) {
  const { cursor, labelId } = await searchParams;
  const labels = await fetchLabels();

  let page: PublicEventsPage;
  try {
    const qs = new URLSearchParams({ limit: "20" });
    if (cursor) qs.set("cursor", cursor);
    if (labelId) qs.set("labelId", labelId);
    page = await publicApiFetch<PublicEventsPage>(
      `/public/events?${qs.toString()}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      // Stale or malformed cursor — start over.
      const qsClean = new URLSearchParams({ limit: "20" });
      if (labelId) qsClean.set("labelId", labelId);
      page = await publicApiFetch<PublicEventsPage>(
        `/public/events?${qsClean.toString()}`,
      );
    } else {
      throw err;
    }
  }

  return (
    <PublicShell>
      <div
        className="container container--wide"
        style={{ paddingTop: 48, paddingBottom: 72 }}
      >
        <Eyebrow>The calendar</Eyebrow>
        <Display as="h1" size="lg" style={{ margin: "12px 0 24px" }}>
          Upcoming events
        </Display>
        {labels.length > 0 && <FilterChips labels={labels} />}
        {page.items.length === 0 ? (
          <p className="muted">
            No upcoming events yet. Check back soon.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 22,
            }}
          >
            {page.items.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        )}
        {page.nextCursor && (
          <div style={{ marginTop: 32, textAlign: "right" }}>
            <a
              href={`/events?${new URLSearchParams({
                cursor: page.nextCursor,
                ...(labelId ? { labelId } : {}),
              }).toString()}`}
              className="link"
            >
              Next page →
            </a>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
