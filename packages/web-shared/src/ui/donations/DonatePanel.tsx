"use client";

import { useState, useId } from "react";
import { Card } from "../primitives/Card";
import { Button } from "../primitives/Button";
import { Field } from "../primitives/Field";
import { Input } from "../primitives/Input";
import { Segmented } from "../data/Segmented";

export type DonationCadence = "ONCE" | "MONTHLY" | "QUARTERLY" | "YEARLY";

export interface DonatePanelProps {
  campaignId: string;
  campaignSlug: string;
  defaultCurrency: string;
  initialCadence?: DonationCadence;
  initialAmountCents?: number;
  action: string;
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

function formatChipLabel(cents: number, currency: string): string {
  const dollars = cents / 100;
  if (currency.toLowerCase() === "usd") {
    return `$${dollars}`;
  }
  return `${currency.toUpperCase()} ${dollars}`;
}

export function DonatePanel({
  campaignId,
  defaultCurrency,
  initialCadence = "ONCE",
  initialAmountCents,
  action,
  disabled = false,
  disabledReason,
}: DonatePanelProps) {
  const inputId = useId();
  const [cadence, setCadence] = useState<DonationCadence>(initialCadence);
  const [selectedChipCents, setSelectedChipCents] = useState<number | undefined>(
    initialAmountCents,
  );
  const [customValue, setCustomValue] = useState<string>("");

  // Compute amountCents from either chip or custom input
  let amountCents: number | undefined;
  if (customValue !== "") {
    const parsed = parseFloat(customValue);
    if (isFinite(parsed) && parsed > 0) {
      amountCents = Math.round(parsed * 100);
    }
  } else {
    amountCents = selectedChipCents;
  }

  const isSubmitDisabled =
    disabled || amountCents === undefined || amountCents < 100;

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
      <form action={action} method="post">
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
          value={amountCents ?? ""}
        />

        <Segmented
          options={CADENCE_OPTIONS}
          value={cadence}
          onChange={setCadence}
          ariaLabel="Donation frequency"
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
            max="10000"
            value={customValue}
            onChange={handleCustomChange}
            placeholder="Enter amount"
          />
        </Field>

        {disabled && disabledReason && (
          <p role="status">{disabledReason}</p>
        )}

        <Button
          type="submit"
          variant="primary"
          block
          disabled={isSubmitDisabled}
        >
          Continue to donate
        </Button>
      </form>
    </Card>
  );
}
