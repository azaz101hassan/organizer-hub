"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { updateCampaign, type CampaignUpdateFormState } from "./actions";

const INITIAL: CampaignUpdateFormState = {};

interface Campaign {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  coverImageUrl?: string | null;
  targetAmountCents: number;
  currency: string;
  deadline?: string | null;
  displayOrder?: number | null;
}

interface CampaignEditFormProps {
  campaign: Campaign;
}

export default function CampaignEditForm({ campaign }: CampaignEditFormProps) {
  const boundAction = updateCampaign.bind(null, campaign.id);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  // Pre-fill the target field as a dollar amount rounded to 2 decimal places.
  const defaultTarget =
    state.values?.target !== undefined
      ? state.values.target
      : (campaign.targetAmountCents / 100).toFixed(2);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <FormField
        id="edit-name"
        name="name"
        label="Name"
        required
        maxLength={120}
        defaultValue={state.values?.name ?? campaign.name}
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
        placeholder="e.g. spring-drive"
        defaultValue={state.values?.slug ?? campaign.slug}
        disabled={pending}
        error={state.fieldErrors?.slug}
        hint="Lowercase letters, digits, and hyphens only."
      />
      <FormField
        id="edit-description"
        name="description"
        label="Description"
        maxLength={2000}
        defaultValue={state.values?.description ?? campaign.description ?? ""}
        disabled={pending}
        multiline
      />
      <FormField
        id="edit-cover"
        name="coverImageUrl"
        label="Cover image URL"
        maxLength={500}
        placeholder="https://…"
        defaultValue={state.values?.coverImageUrl ?? campaign.coverImageUrl ?? ""}
        disabled={pending}
        error={state.fieldErrors?.coverImageUrl}
        hint="Must start with https://, http://, or /."
      />
      <FormField
        id="edit-target"
        name="target"
        label="Goal in USD"
        type="number"
        required
        min={1}
        max={21474836.47}
        step="0.01"
        placeholder="e.g. 1000"
        defaultValue={defaultTarget}
        disabled={pending}
        error={state.fieldErrors?.target}
      />
      <FormField
        id="edit-currency"
        name="currency"
        label="Currency"
        maxLength={3}
        placeholder="usd"
        defaultValue={state.values?.currency ?? campaign.currency}
        disabled={pending}
        error={state.fieldErrors?.currency}
        hint="3-letter ISO 4217 code (e.g. usd)."
      />
      <FormField
        id="edit-deadline"
        name="deadline"
        label="Deadline"
        type="date"
        defaultValue={
          state.values?.deadline !== undefined
            ? state.values.deadline
            : campaign.deadline
              ? campaign.deadline.slice(0, 10)
              : ""
        }
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
            : campaign.displayOrder !== null && campaign.displayOrder !== undefined
              ? String(campaign.displayOrder)
              : ""
        }
        disabled={pending}
        error={state.fieldErrors?.displayOrder}
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
  step?: string;
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
  step,
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
          step={step}
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
