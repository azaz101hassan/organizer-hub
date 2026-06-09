"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
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
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
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
              className="btn btn--primary btn--sm disabled:opacity-50"
            >
              {createPending ? "Adding…" : "Add label"}
            </button>
          </div>
        </form>
        {createState.error && (
          <p className="mt-2 text-sm text-bad">{createState.error}</p>
        )}
      </section>

      <section>
        <h2 className="text-xs font-semibold uppercase tracking-widest text-faint">
          Existing labels
        </h2>
        {labels.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No labels yet. Create one above.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
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
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(label.name);
  const [slug, setSlug] = useState(label.slug);
  const [sortOrder, setSortOrder] = useState(label.sortOrder.toString());
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<NonNullable<LabelFormState["fieldErrors"]>>({});
  const [pending, startTransition] = useTransition();
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Dismiss inline confirm on Escape
  useEffect(() => {
    if (!confirming) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setConfirming(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  // Auto-focus Cancel when confirm strip appears
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

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

  function confirmDelete() {
    setError(null);
    setConfirming(false);
    startTransition(async () => {
      const result = await deleteLabel(label.id);
      if (result.error) setError(result.error);
    });
  }

  const inUse = label.eventCount > 0;
  const usageLabel = inUse
    ? `${label.eventCount} ${label.eventCount === 1 ? "event" : "events"}`
    : null;

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
              className="btn btn--primary btn--sm disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="btn btn--ghost btn--sm disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
        {error && (
          <p className="mt-2 text-sm text-bad">{error}</p>
        )}
      </li>
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{label.name}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-faint">
          <span>{label.slug} · sort {label.sortOrder}</span>
          {usageLabel ? (
            <span className="text-muted">{usageLabel}</span>
          ) : (
            <span className="text-faint">Not used</span>
          )}
        </p>
        {error && (
          <p className="mt-1 text-xs text-bad">{error}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink whitespace-nowrap">
              Delete &ldquo;{label.name}&rdquo;?
            </span>
            <button
              ref={cancelRef}
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="btn btn--ghost btn--sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={pending}
              className="btn btn--danger btn--sm disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Delete label"}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={pending}
              className="btn btn--ghost btn--sm disabled:opacity-50"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              disabled={pending || inUse}
              title={
                inUse
                  ? `In use by ${label.eventCount} ${label.eventCount === 1 ? "event" : "events"} — reassign or delete those events first`
                  : undefined
              }
              aria-label={
                inUse
                  ? `Cannot delete — label is used by ${label.eventCount} ${label.eventCount === 1 ? "event" : "events"}`
                  : `Delete label ${label.name}`
              }
              className="btn btn--danger btn--sm disabled:opacity-50"
            >
              Delete
            </button>
          </>
        )}
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
    <div className="field">
      <label htmlFor={name} className="field__label">
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
        className="input"
      />
      {error && (
        <p className="mt-1 text-xs text-bad">{error}</p>
      )}
    </div>
  );
}
