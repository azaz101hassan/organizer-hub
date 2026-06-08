"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { transitionCoalition, type CoalitionTransitionFormState } from "./actions";

interface StatusActionsProps {
  coalition: { id: string; status: string };
}

const INITIAL: CoalitionTransitionFormState = {};

export default function StatusActions({ coalition }: StatusActionsProps) {
  const boundAction = transitionCoalition.bind(null, coalition.id);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  const isArchived = coalition.status === "ARCHIVED";

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {isArchived ? (
        <form action={formAction}>
          <input type="hidden" name="op" value="restore" />
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            Restore
          </Button>
        </form>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="op" value="archive" />
          <Button type="submit" variant="ghost" size="sm" disabled={pending}>
            Archive
          </Button>
        </form>
      )}
      {state.error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #dc2626)" }}
        >
          {state.error}
        </p>
      )}
      {state.ok && (
        <p
          role="status"
          style={{ margin: 0, fontSize: 12.5, color: "var(--muted, #6b7280)" }}
        >
          Status updated.
        </p>
      )}
    </div>
  );
}
