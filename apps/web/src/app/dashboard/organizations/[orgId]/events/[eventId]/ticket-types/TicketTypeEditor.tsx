"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import type { TicketTypeView } from "@/lib/api/types";
import {
  createTicketType,
  deleteTicketType,
  updateTicketType,
  type TicketTypeFormState,
} from "./actions";

const INITIAL: TicketTypeFormState = {};

const TIER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "0", label: "Open — anyone can buy" },
  { value: "1", label: "Bronze or higher members claim free" },
  { value: "2", label: "Silver or higher members claim free" },
  { value: "3", label: "Gold members claim free" },
];

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function TicketTypeAddForm({
  orgId,
  eventId,
  disabled,
}: {
  orgId: string;
  eventId: string;
  disabled: boolean;
}) {
  const action = createTicketType.bind(null, orgId, eventId);
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const values = state.values ?? {
    name: "",
    price: "",
    minTierLevel: "0",
    cap: "",
  };

  return (
    <form
      action={formAction}
      className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
    >
      <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Add ticket type
      </h3>

      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
        <Field
          id="add-name"
          name="name"
          label="Name"
          defaultValue={values.name}
          disabled={disabled || pending}
          error={state.fieldErrors?.name}
          placeholder="GA"
        />
        <Field
          id="add-price"
          name="price"
          label="Price (USD)"
          defaultValue={values.price}
          disabled={disabled || pending}
          error={state.fieldErrors?.price}
          placeholder="25.00"
          inputMode="decimal"
        />
        <TierSelect
          id="add-tier"
          defaultValue={values.minTierLevel ?? "0"}
          disabled={disabled || pending}
          error={state.fieldErrors?.minTierLevel}
        />
      </div>

      <div className="sm:max-w-xs">
        <CapField
          id="add-cap"
          defaultValue={values.cap ?? ""}
          disabled={disabled || pending}
          error={state.fieldErrors?.cap}
        />
      </div>

      {state.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled || pending}
          className="rounded-full bg-zinc-900 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-900 px-4 py-1.5 text-xs font-medium hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition"
        >
          {pending ? "Adding…" : "Add ticket type"}
        </button>
        {state.ok && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">
            Added.
          </span>
        )}
      </div>
    </form>
  );
}

export function TicketTypeRow({
  orgId,
  eventId,
  ticketType,
  disabled,
}: {
  orgId: string;
  eventId: string;
  ticketType: TicketTypeView;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletePending, startDelete] = useTransition();

  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  if (editing) {
    return (
      <TicketTypeEditForm
        orgId={orgId}
        eventId={eventId}
        ticketType={ticketType}
        disabled={disabled}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <li className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {ticketType.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          ${centsToDollars(ticketType.priceCents)} ·{" "}
          {tierLabel(ticketType.minTierLevel)} · {capLabel(ticketType)}
        </p>
        {ticketType.cap !== null &&
          ticketType.issuedCount > ticketType.cap && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {ticketType.issuedCount} tickets already issued exceed this cap;
              existing tickets are not revoked.
            </p>
          )}
        {deleteError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {deleteError}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={disabled || deletePending}
          onClick={() => setEditing(true)}
          className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
        >
          Edit
        </button>
        <button
          type="button"
          disabled={disabled || deletePending}
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              setDeleteError(null);
              return;
            }
            startDelete(async () => {
              const res = await deleteTicketType(
                orgId,
                eventId,
                ticketType.id,
              );
              if (res.error) {
                setDeleteError(res.error);
                setConfirmDelete(false);
              }
            });
          }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
            confirmDelete
              ? "bg-red-600 text-white hover:bg-red-500"
              : "border border-zinc-300 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {deletePending
            ? "Deleting…"
            : confirmDelete
              ? "Confirm delete?"
              : "Delete"}
        </button>
      </div>
    </li>
  );
}

// Using useTransition + manual dispatch (rather than useActionState) so the
// "save succeeded → collapse back to view" path is synchronous off the action
// return value, not a useEffect on state.ok (which the lint rule rejects).
function TicketTypeEditForm({
  orgId,
  eventId,
  ticketType,
  disabled,
  onClose,
}: {
  orgId: string;
  eventId: string;
  ticketType: TicketTypeView;
  disabled: boolean;
  onClose: () => void;
}) {
  const [state, setState] = useState<TicketTypeFormState>(INITIAL);
  const [pending, startTransition] = useTransition();

  const values = state.values ?? {
    name: ticketType.name,
    price: centsToDollars(ticketType.priceCents),
    minTierLevel: String(ticketType.minTierLevel),
    cap: ticketType.cap === null ? "" : String(ticketType.cap),
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const next = await updateTicketType(
        orgId,
        eventId,
        ticketType.id,
        state,
        formData,
      );
      if (next.ok) {
        onClose();
        return;
      }
      setState(next);
    });
  }

  return (
    <li className="px-5 py-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
          <Field
            id={`edit-name-${ticketType.id}`}
            name="name"
            label="Name"
            defaultValue={values.name}
            disabled={disabled || pending}
            error={state.fieldErrors?.name}
          />
          <Field
            id={`edit-price-${ticketType.id}`}
            name="price"
            label="Price (USD)"
            defaultValue={values.price}
            disabled={disabled || pending}
            error={state.fieldErrors?.price}
            inputMode="decimal"
          />
          <TierSelect
            id={`edit-tier-${ticketType.id}`}
            defaultValue={values.minTierLevel ?? String(ticketType.minTierLevel)}
            disabled={disabled || pending}
            error={state.fieldErrors?.minTierLevel}
          />
        </div>

        <div className="sm:max-w-xs">
          <CapField
            id={`edit-cap-${ticketType.id}`}
            defaultValue={
              values.cap ??
              (ticketType.cap === null ? "" : String(ticketType.cap))
            }
            disabled={disabled || pending}
            error={state.fieldErrors?.cap}
          />
        </div>

        {state.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={disabled || pending}
            className="rounded-full bg-blue-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-blue-500 disabled:opacity-50 transition"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-full border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
          >
            Cancel
          </button>
        </div>
      </form>
    </li>
  );
}

function capLabel(ticketType: TicketTypeView): string {
  if (ticketType.cap === null) return "No cap";
  return `Cap ${ticketType.cap} · ${ticketType.issuedCount} issued`;
}

function tierLabel(minTierLevel: number): string {
  switch (minTierLevel) {
    case 0:
      return "Open to anyone";
    case 1:
      return "Bronze+ claim free";
    case 2:
      return "Silver+ claim free";
    case 3:
      return "Gold claim free";
    default:
      return `Tier ${minTierLevel}+ claim free`;
  }
}

function Field({
  id,
  name,
  label,
  defaultValue,
  disabled,
  error,
  placeholder,
  inputMode,
  hint,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text";
  hint?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        inputMode={inputMode}
        defaultValue={defaultValue}
        disabled={disabled}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
      />
      {error ? (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

// Capacity input: blank means "no cap". At cap, U5 routes paid purchases and
// free claims into the admin-moderated waitlist instead of issuing instantly.
function CapField({
  id,
  defaultValue,
  disabled,
  error,
}: {
  id: string;
  defaultValue: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <Field
      id={id}
      name="cap"
      label="Capacity"
      defaultValue={defaultValue}
      disabled={disabled}
      error={error}
      placeholder="No cap"
      inputMode="numeric"
      hint="Leave blank for no cap. At capacity, buyers and members join a waitlist you approve."
    />
  );
}

function TierSelect({
  id,
  defaultValue,
  disabled,
  error,
}: {
  id: string;
  defaultValue: string;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-medium uppercase tracking-wide text-zinc-700 dark:text-zinc-300"
      >
        Membership coverage
      </label>
      <select
        id={id}
        name="minTierLevel"
        defaultValue={defaultValue}
        disabled={disabled}
        className="mt-1 block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:opacity-60"
      >
        {TIER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
