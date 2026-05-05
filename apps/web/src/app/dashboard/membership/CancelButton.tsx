"use client";

import { useActionState } from "react";
import { cancelMembership, type CancelState } from "./actions";

const initial: CancelState = {};

export function CancelButton() {
  const [state, formAction, pending] = useActionState(cancelMembership, initial);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <button
        type="submit"
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
        className="rounded-full border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 px-4 py-2 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40 transition disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel membership"}
      </button>
      {state.error && (
        <p className="text-xs text-red-700 dark:text-red-300">{state.error}</p>
      )}
    </form>
  );
}
