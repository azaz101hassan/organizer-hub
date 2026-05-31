"use client";

import { useActionState } from "react";
import { cancelRequest, type CancelRequestState } from "./actions";

const INITIAL: CancelRequestState = {};

export function CancelRequestButton({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(cancelRequest, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button
        type="submit"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm("Cancel this request?")) {
            e.preventDefault();
          }
        }}
        className="rounded-full border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-2 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40 transition disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel request"}
      </button>
      {state.error && (
        <p className="text-xs text-red-700 dark:text-red-300">{state.error}</p>
      )}
    </form>
  );
}
