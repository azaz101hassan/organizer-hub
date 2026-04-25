"use client";

import { useActionState, useTransition } from "react";
import type { EventView } from "@/lib/api/types";
import { toDatetimeLocalValue } from "@/lib/format";
import {
  cancelEvent,
  publishEvent,
  updateEvent,
  type UpdateEventFormState,
} from "./actions";

const INITIAL: UpdateEventFormState = {};

export default function EventEditor({
  orgId,
  eventId,
  event,
  canMutate,
}: {
  orgId: string;
  eventId: string;
  event: EventView;
  canMutate: boolean;
}) {
  const action = updateEvent.bind(null, orgId, eventId);
  const [state, formAction, formPending] = useActionState(action, INITIAL);
  const [transitionPending, startTransition] = useTransition();

  const values = state.values ?? {
    title: event.title,
    description: event.description ?? "",
    startsAt: toDatetimeLocalValue(event.startsAt),
    endsAt: event.endsAt ? toDatetimeLocalValue(event.endsAt) : "",
    venue: event.venue ?? "",
  };

  const disabled = !canMutate || formPending || transitionPending;

  return (
    <div className="space-y-8">
      <form action={formAction} className="space-y-5">
        <Field
          id="title"
          name="title"
          label="Title"
          required
          minLength={2}
          maxLength={120}
          defaultValue={values.title}
          disabled={disabled}
          error={state.fieldErrors?.title}
        />

        <div>
          <label
            htmlFor="description"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
          >
            Description
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={values.description}
            disabled={disabled}
            className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="startsAt"
            name="startsAt"
            label="Starts at"
            type="datetime-local"
            required
            defaultValue={values.startsAt}
            disabled={disabled}
            error={state.fieldErrors?.startsAt}
          />
          <Field
            id="endsAt"
            name="endsAt"
            label="Ends at (optional)"
            type="datetime-local"
            defaultValue={values.endsAt}
            disabled={disabled}
            error={state.fieldErrors?.endsAt}
          />
        </div>

        <Field
          id="venue"
          name="venue"
          label="Venue (optional)"
          maxLength={200}
          defaultValue={values.venue}
          disabled={disabled}
        />

        {state.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}
        {state.ok && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Saved.
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={disabled}
            className="rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {formPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>

      {canMutate && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 pt-6">
          <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Status
          </h3>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {event.status === "DRAFT" && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  startTransition(() => publishEvent(orgId, eventId))
                }
                className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 transition"
              >
                {transitionPending ? "Publishing…" : "Publish"}
              </button>
            )}
            {(event.status === "DRAFT" || event.status === "PUBLISHED") && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  startTransition(() => cancelEvent(orgId, eventId))
                }
                className="rounded-full border border-zinc-300 dark:border-zinc-700 px-4 py-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
              >
                Cancel event
              </button>
            )}
            {event.status === "CANCELLED" && (
              <p className="text-xs text-zinc-500">
                Cancelled events cannot be reactivated.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  id,
  name,
  label,
  type = "text",
  required,
  minLength,
  maxLength,
  defaultValue,
  disabled,
  error,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        defaultValue={defaultValue}
        disabled={disabled}
        className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
      />
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
