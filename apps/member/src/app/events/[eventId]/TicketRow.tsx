"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Badge, Button } from "@organizer-hub/web-shared/ui";
import {
  buyTicket,
  claimFreeTicket,
  requestSpot,
  type ClaimState,
  type RequestSpotState,
} from "./actions";
import type { CoverageResult, TicketTypePublicView } from "@organizer-hub/web-shared";

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

function tierLabel(level: number): string {
  if (level === 1) return "Bronze+";
  if (level === 2) return "Silver+";
  if (level === 3) return "Gold";
  return `Tier ${level}+`;
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
    <li
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "14px 18px",
        borderTop: "1px solid var(--line)",
      }}
      // Remove top border from first child via CSS selector in the parent ul
      className="ticket-row"
    >
      {/* Left: name + sub-text */}
      <div style={{ minWidth: 0 }}>
        <p
          style={{
            fontSize: 14.5,
            fontWeight: 600,
            color: "var(--ink)",
            margin: 0,
          }}
        >
          {ticketType.name}
        </p>
        <p
          className="muted"
          style={{ fontSize: 12.5, margin: "3px 0 0", lineHeight: 1.4 }}
        >
          {priceLabel(ticketType.priceCents)}
          {ticketType.minTierLevel > 0 && (
            <>
              {" · "}
              {tierLabel(ticketType.minTierLevel)} members claim free
            </>
          )}
        </p>
        {errorText && (
          <p
            style={{
              marginTop: 6,
              fontSize: 12.5,
              color: "var(--bad)",
            }}
          >
            {errorText}
          </p>
        )}
        {requestState.ok && (
          <p
            style={{
              marginTop: 6,
              fontSize: 12.5,
              color: "var(--warn)",
            }}
          >
            Request submitted — we&apos;ll email you when the organizer responds.{" "}
            <Link href="/dashboard/requests" className="link">
              Track it in your requests.
            </Link>
          </p>
        )}
      </div>

      {/* Right: action */}
      <div style={{ flexShrink: 0 }}>
        {verdict === "OWNED" ? (
          <Badge tone="published">Ticket claimed</Badge>
        ) : verdict === "AT_CAP" ? (
          coverage.openRequestId ? (
            <Link
              href={`/dashboard/requests/${coverage.openRequestId}`}
              className="btn btn--ghost btn--sm"
            >
              Request pending
            </Link>
          ) : requestState.ok ? (
            <Badge tone="member">Requested</Badge>
          ) : (
            <form action={requestAction}>
              <input type="hidden" name="ticketTypeId" value={ticketType.id} />
              <input type="hidden" name="eventId" value={eventId} />
              <input
                type="hidden"
                name="requestIntent"
                value={coverage.requestIntent ?? "PAID"}
              />
              <Button
                variant="solid"
                size="sm"
                type="submit"
                disabled={requestPending}
              >
                {requestPending ? "Requesting…" : "Request a spot"}
              </Button>
            </form>
          )
        ) : verdict === "CLAIMABLE" ? (
          <form action={claimAction}>
            <input type="hidden" name="ticketTypeId" value={ticketType.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={claimPending}
            >
              {claimPending ? "Claiming…" : "Claim free ticket"}
            </Button>
          </form>
        ) : (
          <form action={buyTicket}>
            <input type="hidden" name="ticketTypeId" value={ticketType.id} />
            <input type="hidden" name="eventId" value={eventId} />
            <Button variant="primary" size="sm" type="submit">
              {signedIn
                ? `Buy ${priceLabel(ticketType.priceCents)}`
                : "Sign in to buy"}
            </Button>
          </form>
        )}
      </div>
    </li>
  );
}
