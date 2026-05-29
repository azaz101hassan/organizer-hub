"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  buyTicket,
  claimFreeTicket,
  requestSpot,
  type ClaimState,
  type RequestSpotState,
} from "./actions";
import type { CoverageResult, TicketTypePublicView } from "@/lib/api/types";

const INITIAL_CLAIM: ClaimState = {};
const INITIAL_REQUEST: RequestSpotState = {};

interface Props {
  eventId: string;
  ticketType: TicketTypePublicView;
  coverage: CoverageResult;
  signedIn: boolean;
}

function priceLabel(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

export default function TicketRow({
  eventId,
  ticketType,
  coverage,
  signedIn,
}: Props) {
  const [claimState, claimAction, claimPending] = useActionState(
    claimFreeTicket,
    INITIAL_CLAIM,
  );
  const [requestState, requestAction, requestPending] = useActionState(
    requestSpot,
    INITIAL_REQUEST,
  );

  const { verdict } = coverage;
  const errorText = claimState.error ?? requestState.error;

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
        {errorText && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {errorText}
          </p>
        )}
        {requestState.ok && (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Request submitted — we&apos;ll email you when the organizer
            responds.{" "}
            <Link href="/dashboard/requests" className="underline">
              Track it in your requests.
            </Link>
          </p>
        )}
      </div>

      <div className="shrink-0">
        {verdict === "OWNED" ? (
          <span className="inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-4 py-1.5 text-xs font-medium">
            Ticket claimed
          </span>
        ) : verdict === "AT_CAP" ? (
          coverage.openRequestId ? (
            <Link
              href={`/dashboard/requests/${coverage.openRequestId}`}
              className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-4 py-1.5 text-xs font-medium hover:bg-amber-200 dark:hover:bg-amber-900/50 transition"
            >
              Request pending
            </Link>
          ) : requestState.ok ? (
            <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-4 py-1.5 text-xs font-medium">
              Requested
            </span>
          ) : (
            <form action={requestAction}>
              <input type="hidden" name="ticketTypeId" value={ticketType.id} />
              <input type="hidden" name="eventId" value={eventId} />
              <input
                type="hidden"
                name="requestIntent"
                value={coverage.requestIntent ?? "PAID"}
              />
              <button
                type="submit"
                disabled={requestPending}
                className="rounded-full bg-amber-600 text-white px-4 py-1.5 text-xs font-medium hover:bg-amber-500 disabled:opacity-50 transition"
              >
                {requestPending ? "Requesting…" : "Request a spot"}
              </button>
            </form>
          )
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
