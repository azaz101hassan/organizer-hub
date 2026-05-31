"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  createOrganization,
  type CreateOrgFormState,
} from "./actions";

const INITIAL: CreateOrgFormState = {};

export default function NewOrganizationPage() {
  const [state, formAction, pending] = useActionState(
    createOrganization,
    INITIAL,
  );

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <Link
          href="/dashboard"
          className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          New organization
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          You&apos;ll become the owner automatically.
        </p>
      </div>

      <form action={formAction} className="space-y-5">
        <div>
          <label
            htmlFor="name"
            className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
          >
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            minLength={2}
            maxLength={80}
            defaultValue={state.values?.name ?? ""}
            disabled={pending}
            className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {state.fieldErrors?.name && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {state.fieldErrors.name}
            </p>
          )}
        </div>

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
            maxLength={500}
            defaultValue={state.values?.description ?? ""}
            disabled={pending}
            className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          {state.fieldErrors?.description && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              {state.fieldErrors.description}
            </p>
          )}
        </div>

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
            {pending ? "Creating…" : "Create organization"}
          </button>
          <Link
            href="/dashboard"
            className="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
