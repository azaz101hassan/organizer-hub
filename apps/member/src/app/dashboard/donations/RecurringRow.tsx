"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  Button,
  formatCurrencyPrefix,
  type DonationCadence,
} from "@organizer-hub/web-shared/ui";
import { cancelRecurringAction, type CancelDonationState } from "./actions";

export interface DonationRow {
  id: string;
  mode: "ONE_TIME" | "RECURRING";
  cadence: DonationCadence;
  amountCents: number;
  currency: string;
  status: "PENDING" | "ACTIVE" | "CANCELED" | "FAILED" | "COMPLETED";
  campaign: {
    id: string;
    slug: string;
    name: string;
    coalition: {
      id: string;
      slug: string;
      name: string;
    };
  };
}

// ONCE is excluded — this page renders only RECURRING-mode donations,
// and ONCE only appears on one-time donations. Other cadences map to the
// frequency word shown alongside the amount.
const CADENCE_LABEL: Partial<Record<DonationCadence, string>> = {
  MONTHLY: "month",
  QUARTERLY: "quarter",
  YEARLY: "year",
};

function fmtAmount(amountCents: number, currency: string): string {
  const prefix = formatCurrencyPrefix(currency);
  return `${prefix}${(amountCents / 100).toFixed(2)}`;
}

const INITIAL: CancelDonationState = {};

export function RecurringRow({ row, index }: { row: DonationRow; index: number }) {
  const [state, formAction, pending] = useActionState(cancelRecurringAction, INITIAL);
  const cadenceWord = CADENCE_LABEL[row.cadence];
  const amountStr = fmtAmount(row.amountCents, row.currency);
  const amountDisplay = cadenceWord ? `${amountStr} / ${cadenceWord}` : amountStr;

  return (
    <li
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "13px 20px",
        flexWrap: "wrap",
        borderTop: index > 0 ? "1px solid var(--line)" : undefined,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14 }}>
          <Link
            href={`/campaigns/${row.campaign.slug}`}
            className="link"
          >
            {row.campaign.name}
          </Link>
        </div>
        <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
          {row.campaign.coalition.name}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexShrink: 0,
          marginLeft: "auto",
        }}
      >
        <span className="mono" style={{ fontSize: 13.5, whiteSpace: "nowrap" }}>
          {amountDisplay}
        </span>
        {row.status === "PENDING" ? (
          <span
            className="faint"
            style={{
              fontSize: 12,
              padding: "3px 8px",
              borderRadius: 999,
              border: "1px solid var(--line)",
              whiteSpace: "nowrap",
            }}
          >
            Checkout pending
          </span>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <form action={formAction}>
              <input type="hidden" name="donationId" value={row.id} />
              <Button
                type="submit"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={(e) => {
                  if (
                    !window.confirm(
                      "Cancel this recurring donation? You won't be charged again, but your current contribution still goes through.",
                    )
                  ) {
                    e.preventDefault();
                  }
                }}
              >
                {pending ? "Cancelling…" : "Cancel"}
              </Button>
            </form>
            {state.error && (
              <p
                role="alert"
                style={{ fontSize: 12, color: "var(--bad)", margin: 0 }}
              >
                {state.error}
              </p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
