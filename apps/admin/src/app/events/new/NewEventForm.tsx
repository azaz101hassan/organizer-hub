"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createEvent,
  type CreateEventFormState,
} from "./actions";

const INITIAL: CreateEventFormState = {};

export default function NewEventForm({ orgId }: { orgId: string }) {
  const action = createEvent.bind(null, orgId);
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <Link
          href="/events"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← Back to events
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          New event
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Saved as a draft. Publish it when you&apos;re ready.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        <Field
          id="title"
          name="title"
          label="Title"
          required
          minLength={2}
          maxLength={120}
          defaultValue={state.values?.title ?? ""}
          disabled={pending}
          error={state.fieldErrors?.title}
        />

        <div>
          <label
            htmlFor="description"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
          >
            Description{" "}
            <span className="text-zinc-400 normal-case">(optional)</span>
          </label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={state.values?.description ?? ""}
            disabled={pending}
            className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id="startsAt"
            name="startsAt"
            label="Starts at"
            type="datetime-local"
            required
            defaultValue={state.values?.startsAt ?? ""}
            disabled={pending}
            error={state.fieldErrors?.startsAt}
          />
          <Field
            id="endsAt"
            name="endsAt"
            label="Ends at (optional)"
            type="datetime-local"
            defaultValue={state.values?.endsAt ?? ""}
            disabled={pending}
            error={state.fieldErrors?.endsAt}
          />
        </div>

        <Field
          id="venue"
          name="venue"
          label="Venue (optional)"
          maxLength={200}
          defaultValue={state.values?.venue ?? ""}
          disabled={pending}
        />

        {state.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-blue-600 text-white px-5 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {pending ? "Saving…" : "Save draft"}
          </button>
          <Link
            href="/events"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Cancel
          </Link>
        </div>
      </form>
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
        className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
