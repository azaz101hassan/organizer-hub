"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { createCampaign, type CampaignCreateFormState } from "./actions";

const INITIAL: CampaignCreateFormState = {};

interface NewCampaignDialogProps {
  coalitionId: string;
}

export default function NewCampaignDialog({ coalitionId }: NewCampaignDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [formKey, setFormKey] = useState(0);
  const boundAction = createCampaign.bind(null, coalitionId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  useEffect(() => {
    if (state.ok) {
      dialogRef.current?.close();
    }
  }, [state.ok]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      triggerRef.current?.focus();
      setFormKey((k) => k + 1);
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, []);

  function open() {
    triggerRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.showModal();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  }

  return (
    <>
      <Button variant="primary" size="sm" type="button" onClick={open}>
        New campaign
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="new-campaign-title"
        onClick={handleBackdropClick}
        style={{
          border: "none",
          borderRadius: 12,
          padding: 0,
          maxWidth: 520,
          width: "calc(100vw - 32px)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        }}
      >
        <div style={{ padding: "28px 28px 24px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            <h2
              id="new-campaign-title"
              style={{ margin: 0, fontSize: 17, fontWeight: 600 }}
            >
              New campaign
            </h2>
            <button
              type="button"
              aria-label="Close"
              onClick={() => dialogRef.current?.close()}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                fontSize: 20,
                lineHeight: 1,
                color: "var(--muted)",
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>

          <form
            key={formKey}
            action={formAction}
            style={{ display: "flex", flexDirection: "column", gap: 14 }}
          >
            <FormField
              id="camp-name"
              name="name"
              label="Name"
              required
              maxLength={120}
              defaultValue={state.values?.name ?? ""}
              disabled={pending}
              error={state.fieldErrors?.name}
            />
            <FormField
              id="camp-slug"
              name="slug"
              label="Slug"
              required
              maxLength={80}
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]"
              placeholder="e.g. spring-drive"
              defaultValue={state.values?.slug ?? ""}
              disabled={pending}
              error={state.fieldErrors?.slug}
              hint="Lowercase letters, digits, and hyphens only."
            />
            <FormField
              id="camp-description"
              name="description"
              label="Description"
              maxLength={2000}
              defaultValue={state.values?.description ?? ""}
              disabled={pending}
              multiline
            />
            <FormField
              id="camp-cover"
              name="coverImageUrl"
              label="Cover image URL"
              maxLength={500}
              placeholder="https://…"
              defaultValue={state.values?.coverImageUrl ?? ""}
              disabled={pending}
              error={state.fieldErrors?.coverImageUrl}
              hint="Must start with https://, http://, or /."
            />
            <FormField
              id="camp-target"
              name="target"
              label="Goal in USD"
              type="number"
              required
              min={1}
              step="0.01"
              placeholder="e.g. 1000"
              defaultValue={state.values?.target ?? ""}
              disabled={pending}
              error={state.fieldErrors?.target}
            />
            <FormField
              id="camp-currency"
              name="currency"
              label="Currency"
              maxLength={3}
              placeholder="usd"
              defaultValue={state.values?.currency ?? ""}
              disabled={pending}
              error={state.fieldErrors?.currency}
              hint="3-letter ISO 4217 code (e.g. usd). Leave blank to use usd."
            />
            <FormField
              id="camp-deadline"
              name="deadline"
              label="Deadline"
              type="date"
              defaultValue={state.values?.deadline ?? ""}
              disabled={pending}
            />
            <FormField
              id="camp-order"
              name="displayOrder"
              label="Display order"
              type="number"
              min={0}
              max={9999}
              defaultValue={
                state.values?.displayOrder !== undefined
                  ? String(state.values.displayOrder)
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

            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => dialogRef.current?.close()}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={pending}>
                {pending ? "Creating…" : "Create campaign"}
              </Button>
            </div>
          </form>
        </div>
      </dialog>
    </>
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
        <p
          role="alert"
          style={{ margin: "3px 0 0", fontSize: 11.5, color: "var(--bad, #dc2626)" }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
