"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { createCoalition, type CoalitionFormState } from "./actions";

const INITIAL: CoalitionFormState = {};

export default function NewCoalitionDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    function handleClose() {
      triggerRef.current?.focus();
      setGeneration((g) => g + 1);
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
        New coalition
      </Button>

      <dialog
        ref={dialogRef}
        aria-labelledby="new-coalition-title"
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
        <NewCoalitionDialogContent
          key={generation}
          onClose={() => dialogRef.current?.close()}
        />
      </dialog>
    </>
  );
}

function NewCoalitionDialogContent({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState(createCoalition, INITIAL);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
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
          id="new-coalition-title"
          style={{ margin: 0, fontSize: 17, fontWeight: 600 }}
        >
          New coalition
        </h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
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

      <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <FormField
          id="coal-name"
          name="name"
          label="Name"
          required
          maxLength={120}
          defaultValue={state.values?.name ?? ""}
          disabled={pending}
          error={state.fieldErrors?.name}
        />
        <FormField
          id="coal-slug"
          name="slug"
          label="Slug"
          required
          maxLength={80}
          pattern="[a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9]"
          placeholder="e.g. climate-action"
          defaultValue={state.values?.slug ?? ""}
          disabled={pending}
          error={state.fieldErrors?.slug}
          hint="Lowercase letters, digits, and hyphens only."
        />
        <FormField
          id="coal-description"
          name="description"
          label="Description"
          maxLength={2000}
          defaultValue={state.values?.description ?? ""}
          disabled={pending}
          multiline
        />
        <FormField
          id="coal-cover"
          name="coverImageUrl"
          label="Cover image URL"
          maxLength={500}
          placeholder="https://…"
          defaultValue={state.values?.coverImageUrl ?? ""}
          disabled={pending}
        />
        <FormField
          id="coal-order"
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

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create coalition"}
          </Button>
        </div>
      </form>
    </div>
  );
}

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
        {required && <span aria-hidden style={{ color: "var(--bad, #dc2626)", marginLeft: 2 }}>*</span>}
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
