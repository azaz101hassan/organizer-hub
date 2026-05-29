// Pure capacity predicate shared by the paid-checkout, free-claim, and public
// affordance paths (R3, R20) so the "is this tier full?" decision cannot drift
// between the three surfaces. No DB and no DI on purpose — the issued count is
// supplied by the caller (TicketTypesService.computeIssuedCount). A null cap
// means "no cap" (Phase 3 behavior) and short-circuits before any COUNT is run.
export function atCap(
  ticketType: { cap: number | null },
  issuedCount: number,
): boolean {
  return ticketType.cap !== null && issuedCount >= ticketType.cap;
}
