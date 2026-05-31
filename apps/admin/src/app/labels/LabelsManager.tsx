"use client";

import { useActionState, useState, useTransition } from "react";
import type { EventLabelView } from "@organizer-hub/web-shared";
import {
  createLabel,
  deleteLabel,
  renameLabel,
  type LabelFormState,
} from "./actions";

const INITIAL: LabelFormState = {};

export default function LabelsManager({ labels }: { labels: EventLabelView[] }) {
  const [createState, createAction, createPending] = useActionState(
    createLabel,
    INITIAL,
  );

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          New label
        </h2>
        <form action={createAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto]">
          <TextField
            name="name"
            label="Name"
            required
            maxLength={60}
            defaultValue={createState.values?.name ?? ""}
            disabled={createPending}
            error={createState.fieldErrors?.name}
          />
          <TextField
            name="slug"
            label="Slug"
            required
            maxLength={60}
            defaultValue={createState.values?.slug ?? ""}
            disabled={createPending}
            error={createState.fieldErrors?.slug}
          />
          <TextField
            name="sortOrder"
            label="Sort"
            type="number"
            min={0}
            defaultValue={createState.values?.sortOrder?.toString() ?? ""}
            disabled={createPending}
          />
          <div className="flex items-end">
            <button
              type="submit"
              disabled={createPending}
              className="h-10 rounded-full bg-blue-600 text-white px-5 text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {createPending ? "Adding…" : "Add label"}
            </button>
          </div>
        </form>
        {createState.error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{createState.error}</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300">
          Existing labels
        </h2>
        {labels.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No labels yet. Create one above.</p>
        ) : (
          <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
            {labels.map((label) => (
              <LabelRow key={label.id} label={label} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LabelRow({ label }: { label: EventLabelView }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [slug, setSlug] = useState(label.slug);
  const [sortOrder, setSortOrder] = useState(label.sortOrder.toString());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<NonNullable<LabelFormState["fieldErrors"]>>({});
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("slug", slug);
      fd.set("sortOrder", sortOrder);
      const result = await renameLabel(label.id, fd);
      if (result.error) setError(result.error);
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      if (result.ok) setEditing(false);
    });
  }

  function cancel() {
    setName(label.name);
    setSlug(label.slug);
    setSortOrder(label.sortOrder.toString());
    setError(null);
    setFieldErrors({});
    setEditing(false);
  }

  function remove() {
    setError(null);
    if (!confirm(`Delete label "${label.name}"?`)) return;
    startTransition(async () => {
      const result = await deleteLabel(label.id);
      if (result.error) setError(result.error);
    });
  }

  if (editing) {
    return (
      <li className="px-5 py-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_120px_auto_auto]">
          <TextField
            name="name"
            label="Name"
            required
            maxLength={60}
            value={name}
            onChange={(v) => setName(v)}
            disabled={pending}
            error={fieldErrors.name}
          />
          <TextField
            name="slug"
            label="Slug"
            required
            maxLength={60}
            value={slug}
            onChange={(v) => setSlug(v)}
            disabled={pending}
            error={fieldErrors.slug}
          />
          <TextField
            name="sortOrder"
            label="Sort"
            type="number"
            min={0}
            value={sortOrder}
            onChange={(v) => setSortOrder(v)}
            disabled={pending}
          />
          <div className="flex items-end">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="h-10 rounded-full bg-blue-600 text-white px-4 text-xs font-medium hover:bg-blue-500 disabled:opacity-50 transition"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="h-10 rounded-full border border-zinc-300 dark:border-zinc-700 px-4 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              Cancel
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">{label.name}</p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {label.slug} · sort {label.sortOrder}
        </p>
        {error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={pending}
          className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
        >
          Rename
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-full border border-red-300 dark:border-red-800 px-3 py-1 text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 transition"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

interface TextFieldProps {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  error?: string;
}

function TextField(props: TextFieldProps) {
  const {
    name,
    label,
    type = "text",
    required,
    maxLength,
    min,
    defaultValue,
    value,
    onChange,
    disabled,
    error,
  } = props;
  return (
    <div>
      <label
        htmlFor={name}
        className="block text-xs font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        min={min}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        disabled={disabled}
        className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
      />
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
