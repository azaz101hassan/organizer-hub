"use client";

import { useActionState } from "react";
import { buyTicket, claimFreeTicket, type ClaimState } from "./actions";
import type { CoverageVerdict, TicketTypePublicView } from "@/lib/api/types";

const INITIAL: ClaimState = {};

interface Props {
  eventId: string;
  ticketType: TicketTypePublicView;
  verdict: CoverageVerdict;
  signedIn: boolean;
}

function priceLabel(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function TicketRow({
  eventId,
  ticketType,
  verdict,
  signedIn,
}: Props) {
  const [claimState, claimAction, claimPending] = useActionState(
    claimFreeTicket,
    INITIAL,
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
          {ticketType.name}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">
          {priceLabel(ticketType.priceCents)}
          {ticketType.minTierLevel > 0 && (
            <>
              {" · "}
              {tierLabel(ticketType.minTierLevel)} members claim free
            </>
          )}
        </p>
        {claimState.error && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {claimState.error}
          </p>
        )}
      </div>

      <div className="shrink-0">
        {verdict === "OWNED" ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-4 py-1.5 text-xs font-medium">
            Ticket claimed
          </span>
        ) : verdict === "CLAIMABLE" ? (
          <form action={claimAction}>
            <input type="hidden" name="ticketTypeId" value={ticketType.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              disabled={claimPending}
              className="rounded-full bg-emerald-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              {claimPending ? "Claiming…" : "Claim free ticket"}
            </button>
          </form>
        ) : (
          <form action={buyTicket}>
            <input type="hidden" name="ticketTypeId" value={ticketType.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <button
              type="submit"
              className="rounded-full bg-blue-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-blue-500 transition"
            >
              {signedIn
                ? `Buy ${priceLabel(ticketType.priceCents)}`
                : "Sign in to buy"}
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

function tierLabel(level: number): string {
  if (level === 1) return "Bronze+";
  if (level === 2) return "Silver+";
  if (level === 3) return "Gold";
  return `Tier ${level}+`;
}
