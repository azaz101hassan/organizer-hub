"use client";

import { useState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Card } from "../primitives/Card";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Segmented } from "../data/Segmented";
import { formatCurrencyPrefix } from "./currency";

export type DonationCadence = "ONCE" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface DonatePanelProps {
  campaignId: string;
  defaultCurrency: string;
  defaultCadence?: DonationCadence;
  defaultAmountCents?: number;
  action: string | ((formData: FormData) => void | Promise<void>);
  disabled?: boolean;
  disabledReason?: string;
}

const CADENCE_OPTIONS: { value: DonationCadence; label: string }[] = [
  { value: "ONCE", label: "One-time" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "YEARLY", label: "Yearly" },
];

const CHIP_CENTS = [1000, 2500, 5000, 10000];
const MIN_CENTS = 100;

function formatChipLabel(cents: number, currency: string): string {
  const prefix = formatCurrencyPrefix(currency);
  return `${prefix}${cents / 100}`;
}

function parseCustomCents(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return undefined;
  const intPart = match[1] ?? "0";
  const fracPart = (match[2] ?? "").padEnd(2, "0");
  const cents = parseInt(intPart, 10) * 100 + parseInt(fracPart || "0", 10);
  return Number.isFinite(cents) && cents > 0 ? cents : undefined;
}

function sanitizeInitialChip(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < MIN_CENTS) return undefined;
  return value;
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="primary"
      block
      disabled={disabled || pending}
    >
      {pending ? "Redirecting…" : "Continue to donate"}
    </Button>
  );
}

export function DonatePanel({
  campaignId,
  defaultCurrency,
  defaultCadence = "ONCE",
  defaultAmountCents,
  action,
  disabled = false,
  disabledReason,
}: DonatePanelProps) {
  const inputId = useId();
  const [cadence, setCadence] = useState<DonationCadence>(defaultCadence);
  const [selectedChipCents, setSelectedChipCents] = useState<number | undefined>(
    sanitizeInitialChip(defaultAmountCents),
  );
  const [customValue, setCustomValue] = useState<string>("");

  let amountCents: number | undefined;
  if (customValue !== "") {
    amountCents = parseCustomCents(customValue);
  } else {
    amountCents = selectedChipCents;
  }

  const hasUsableAmount =
    amountCents !== undefined &&
    Number.isFinite(amountCents) &&
    amountCents >= MIN_CENTS;
  const isSubmitDisabled = disabled || !hasUsableAmount;
  const hiddenAmountValue = hasUsableAmount ? String(amountCents) : "";

  function handleChipClick(cents: number) {
    setSelectedChipCents(cents);
    setCustomValue("");
  }

  function handleCustomChange(e: React.ChangeEvent<HTMLInputElement>) {
    setCustomValue(e.target.value);
    setSelectedChipCents(undefined);
  }

  return (
    <Card padded>
      <form action={action}>
        <input type="hidden" name="campaignId" value={campaignId} />
        <input
          type="hidden"
          name="cadence"
          data-testid="cadence-input"
          value={cadence}
        />
        <input
          type="hidden"
          name="amountCents"
          data-testid="amount-input"
          value={hiddenAmountValue}
        />

        <fieldset
          disabled={disabled}
          style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}
        >
          <Segmented
            options={CADENCE_OPTIONS}
            value={cadence}
            onChange={setCadence}
            label="Donation frequency"
          />

          <div role="group" aria-label="Donation amount">
            {CHIP_CENTS.map((cents) => {
              const isActive = selectedChipCents === cents && customValue === "";
              return (
                <Button
                  key={cents}
                  type="button"
                  variant={isActive ? "primary" : "ghost"}
                  aria-pressed={isActive}
                  onClick={() => handleChipClick(cents)}
                >
                  {formatChipLabel(cents, defaultCurrency)}
                </Button>
              );
            })}
          </div>

          <Field label="Custom amount" htmlFor={inputId}>
            <Input
              id={inputId}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="1"
              value={customValue}
              onChange={handleCustomChange}
              placeholder="Enter amount"
            />
          </Field>

          <SubmitButton disabled={isSubmitDisabled} />
        </fieldset>

        {disabled && disabledReason && (
          <p role="status" aria-live="polite">
            {disabledReason}
          </p>
        )}
      </form>
    </Card>
  );
}
