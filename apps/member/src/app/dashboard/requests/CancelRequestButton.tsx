"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { cancelRequest, type CancelRequestState } from "./actions";

const INITIAL: CancelRequestState = {};

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelRequest, INITIAL);

  return (
    <form action={action} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input type="hidden" name="requestId" value={requestId} />
      <Button
        type="submit"
        variant="danger"
        size="sm"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm("Cancel this request?")) {
            e.preventDefault();
          }
        }}
      >
        {pending ? "Cancelling…" : "Cancel request"}
      </Button>
      {state.error && (
        <p style={{ fontSize: 12, color: "var(--bad)", margin: 0 }}>{state.error}</p>
      )}
    </form>
  );
}
