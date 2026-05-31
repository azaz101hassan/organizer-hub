"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { cancelMembership, type CancelState } from "./actions";

const initial: CancelState = {};

export function CancelButton() {
  const [state, formAction, pending] = useActionState(cancelMembership, initial);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Button
        type="submit"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={(e) => {
          if (
            !window.confirm(
              "Cancel your membership? Access continues until the end of the current billing period.",
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        {pending ? "Cancelling…" : "Cancel membership"}
      </Button>
      {state.error && (
        <p style={{ fontSize: 12, color: "var(--bad)", margin: 0 }}>{state.error}</p>
      )}
    </form>
  );
}
