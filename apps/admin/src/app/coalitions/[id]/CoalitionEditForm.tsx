"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { updateCoalition, type CoalitionUpdateFormState } from "./actions";

const INITIAL: CoalitionUpdateFormState = {};

interface Coalition {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  coverImageUrl?: string | null;
  displayOrder?: number | null;
}

interface CoalitionEditFormProps {
  coalition: Coalition;
}

export default function CoalitionEditForm({ coalition }: CoalitionEditFormProps) {
  const boundAction = updateCoalition.bind(null, coalition.id);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FormField
        id="edit-name"
        name="name"
        label="Name"
        required
        maxLength={120}
        defaultValue={state.values?.name ?? coalition.name}
        disabled={pending}
        error={state.fieldErrors?.name}
      />
      <FormField
        id="edit-slug"
        name="slug"
        label="Slug"
        required
        maxLength={80}
        pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]"
        placeholder="e.g. climate-action"
        defaultValue={state.values?.slug ?? coalition.slug}
        disabled={pending}
        error={state.fieldErrors?.slug}
        hint="Lowercase letters, digits, and hyphens only."
      />
      <FormField
        id="edit-description"
        name="description"
        label="Description"
        maxLength={2000}
        defaultValue={state.values?.description ?? coalition.description ?? ""}
        disabled={pending}
        multiline
      />
      <FormField
        id="edit-cover"
        name="coverImageUrl"
        label="Cover image URL"
        maxLength={500}
        placeholder="https://…"
        defaultValue={state.values?.coverImageUrl ?? coalition.coverImageUrl ?? ""}
        disabled={pending}
      />
      <FormField
        id="edit-order"
        name="displayOrder"
        label="Display order"
        type="number"
        min={0}
        max={9999}
        defaultValue={
          state.values?.displayOrder !== undefined
            ? String(state.values.displayOrder)
            : coalition.displayOrder !== null && coalition.displayOrder !== undefined
              ? String(coalition.displayOrder)
              : ""
        }
        disabled={pending}
      />

      {state.error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: 13, color: "var(--bad, #dc2626)" }}
        >
          {state.error}
        </p>
      )}

      {state.ok && (
        <p
          role="status"
          style={{ margin: 0, fontSize: 13, color: "var(--good, #16a34a)" }}
        >
          Changes saved.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

// ─── FormField ────────────────────────────────────────────────────────────────

interface FormFieldProps {
  id: string;
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  multiline?: boolean;
}

function FormField({
  id,
  name,
  label,
  type = "text",
  required,
  maxLength,
  min,
  max,
  pattern,
  placeholder,
  defaultValue,
  disabled,
  error,
  hint,
  multiline,
}: FormFieldProps) {
  const inputStyle: React.CSSProperties = {
    marginTop: 4,
    display: "block",
    width: "100%",
    borderRadius: 8,
    border: "1px solid var(--border, #d1d5db)",
    background: "var(--surface, #fff)",
    padding: multiline ? "8px 10px" : "0 10px",
    fontSize: 14,
    height: multiline ? undefined : 36,
    minHeight: multiline ? 72 : undefined,
    color: "var(--ink)",
    boxSizing: "border-box",
  };

  return (
    <div>
      <label
        htmlFor={id}
        style={{ fontSize: 12.5, fontWeight: 500, color: "var(--muted)" }}
      >
        {label}
        {required && (
          <span aria-hidden style={{ color: "var(--bad, #dc2626)", marginLeft: 2 }}>
            *
          </span>
        )}
      </label>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          maxLength={maxLength}
          placeholder={placeholder}
          defaultValue={defaultValue}
          disabled={disabled}
          rows={3}
          style={inputStyle}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          maxLength={maxLength}
          min={min}
          max={max}
          pattern={pattern}
          placeholder={placeholder}
          defaultValue={defaultValue}
          disabled={disabled}
          style={inputStyle}
        />
      )}
      {hint && !error && (
        <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--muted)" }}>{hint}</p>
      )}
      {error && (
        <p role="alert" style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--bad, #dc2626)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
