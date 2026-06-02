"use client";

import { useActionState } from "react";
import { Button } from "@organizer-hub/web-shared/ui";
import { transitionCampaign, type CampaignTransitionFormState } from "./actions";

type CampaignStatus = "DRAFT" | "ACTIVE" | "COMPLETE" | "ARCHIVED";

interface StatusActionsProps {
  campaign: { id: string; status: CampaignStatus; coalitionId: string };
}

const INITIAL: CampaignTransitionFormState = {};

// Legal transitions per status: [label, targetStatus, variant]
const TRANSITIONS: Record<
  CampaignStatus,
  Array<{ label: string; to: CampaignStatus; variant: "primary" | "ghost" }>
> = {
  DRAFT: [
    { label: "Publish", to: "ACTIVE", variant: "primary" },
    { label: "Archive", to: "ARCHIVED", variant: "ghost" },
  ],
  ACTIVE: [
    { label: "Mark complete", to: "COMPLETE", variant: "primary" },
    { label: "Archive", to: "ARCHIVED", variant: "ghost" },
  ],
  COMPLETE: [
    { label: "Reopen", to: "ACTIVE", variant: "primary" },
    { label: "Archive", to: "ARCHIVED", variant: "ghost" },
  ],
  ARCHIVED: [{ label: "Restore to draft", to: "DRAFT", variant: "primary" }],
};

export default function StatusActions({ campaign }: StatusActionsProps) {
  const boundAction = transitionCampaign.bind(null, campaign.id, campaign.coalitionId);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL);

  const transitions = TRANSITIONS[campaign.status] ?? [];

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      {transitions.map(({ label, to, variant }) => (
        <form key={to} action={formAction}>
          <input type="hidden" name="to" value={to} />
          <Button type="submit" variant={variant} size="sm" disabled={pending}>
            {label}
          </Button>
        </form>
      ))}
      {state.error && (
        <p
          role="alert"
          style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #dc2626)" }}
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
