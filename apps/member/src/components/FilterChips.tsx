"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Chip } from "@organizer-hub/web-shared/ui";

export function FilterChips({
  labels,
}: {
  labels: { id: string; name: string }[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("labelId");

  function pick(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) {
      next.set("labelId", id);
    } else {
      next.delete("labelId");
    }
    // Clear cursor when changing filter so we start from the first page
    next.delete("cursor");
    router.push(`/events?${next.toString()}`);
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30 }}>
      <Chip active={!active} onClick={() => pick(null)}>
        All
      </Chip>
      {labels.map((l) => (
        <Chip key={l.id} active={active === l.id} onClick={() => pick(l.id)}>
          {l.name}
        </Chip>
      ))}
    </div>
  );
}
