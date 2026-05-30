---
title: "Commit-then-send mailer seam: injectable email with best-effort delivery"
date: 2026-05-30
category: design-patterns
module: mail
problem_type: design_pattern
component: service_object
severity: medium
applies_when:
  - Adding an outbound messaging SDK (email, SMS, push) to a NestJS app
  - Sending notifications after a state transition that must not block or roll back the response
  - Writing e2e tests for flows that trigger outbound email
  - Constructing email deep-links that embed a WEB_ORIGIN base URL
tags: [mailer, resend, commit-then-send, dependency-injection, testing-seam, nestjs, best-effort]
---

# Commit-then-send mailer seam: injectable email with best-effort delivery

## Context

Transactional email (Resend SDK) introduces two problems structurally identical to the Stripe SDK problem solved in Phase 3:

1. **Testability.** The Resend SDK calls `fetch()` internally. Without DI, e2e tests either hit the real API or need brittle module-level mocks.
2. **Failure semantics.** Email delivery is best-effort. If `mailer.send()` throws after the database has committed an approval, the HTTP response returns 500 even though the approval succeeded. Worse, if the send happens inside a `$transaction`, a Resend outage rolls back the entire approval.

## Guidance

Two-part pattern: (a) a DI seam so the SDK can be replaced in tests, and (b) commit-then-send discipline so delivery failures are logged, never propagated.

### 1. SDK seam with interface + DI token

```typescript
export const RESEND_CLIENT = Symbol('RESEND_CLIENT');
export interface ResendLike {
  emails: {
    send(payload: ResendSendPayload): Promise<{
      data: { id: string } | null;
      error: { message: string } | null;
    }>;
  };
}
```

The interface captures only the SDK surface the app uses. `@Inject(RESEND_CLIENT)` in the Mailer constructor.

### 2. @Global module with graceful boot on missing key

```typescript
@Global()
@Module({
  providers: [{
    provide: RESEND_CLIENT,
    useFactory: (config: ConfigService): ResendLike => {
      const apiKey = config.get<string>('RESEND_API_KEY');
      if (!apiKey) {
        new Logger('MailModule').warn('RESEND_API_KEY not set — email will fail.');
      }
      return new Resend(apiKey || 're_placeholder_unused');
    },
    inject: [ConfigService],
  }, Mailer],
  exports: [Mailer],
})
export class MailModule {}
```

Missing key warns but does not throw — the app boots in test environments without Resend credentials.

### 3. Commit-then-send: never call send() inside a transaction

```typescript
await this.prisma.$transaction(async (tx) => {
  await this.transitions.transition(id, PENDING, REJECTED, tx);
  await this.transitions.writeAudit(tx, { ... });
});
// Transaction committed. DB is the system of record.
if (req.userEmail) {
  await this.mailer.send({ template: 'rejected', to: req.userEmail, props: { ... } });
}
```

### 4. send() NEVER throws

Both Resend-level rejections and network failures are caught and logged. The caller's `await` resolves cleanly either way. The `/dashboard/requests` UI is the system of record if mail is lost.

### 5. Fail-fast WEB_ORIGIN validation at construction

`assertWebOrigin()` validates `WEB_ORIGIN` at boot, not at send time. A missing or malformed origin throws immediately — broken email deep-links are caught during startup rather than shipping silently in production mail.

### 6. Type-safe template dispatch via discriminated union

```typescript
export type MailMessage =
  | { template: 'paid-approved'; to: string; props: PaidApprovedProps }
  | { template: 'claim-approved'; to: string; props: ClaimApprovedProps }
  | { template: 'rejected'; to: string; props: RejectedProps };
```

Adding a new template requires a union member, a render function, and a switch case — the compiler enforces completeness.

## Why This Matters

Without commit-then-send: a Resend outage inside a `$transaction` rolls back a successful approval. The admin clicked "Approve," the response is 500, the request is still PENDING, and the audit trail records nothing.

Without the DI seam: e2e tests need a live Resend API key or resort to `jest.mock('resend')` at the module level.

Without fail-fast `assertWebOrigin`: a missing env var ships emails with `undefined/dashboard/requests` links. The error is silent — the email sends, but the link is broken.

## When to Apply

- Integrating any outbound messaging SDK in a NestJS app
- The send happens as a side-effect of a database state transition
- You need e2e tests that verify "the right message was sent" without network calls
- Your templates contain deep-links back to the app

**Do not apply when:** the external call IS the operation itself (e.g., Stripe Checkout creation where the response URL is needed), or you have an outbox/queue pattern where sends are retried asynchronously.

## Examples

| File | Role |
|---|---|
| `apps/api/src/mail/mailer.ts` | Mailer service, RESEND_CLIENT token, assertWebOrigin |
| `apps/api/src/mail/mail.module.ts` | @Global module with SDK factory |
| `apps/api/src/mail/types.ts` | MailMessage discriminated union |
| `apps/api/src/mail/mailer.spec.ts` | Unit tests: delivery, never-throw, XSS escaping, fail-fast |
| `apps/api/test/helpers/fake-mailer.ts` | FakeMailer with `sent` array and `lastOf()` helper |

## Related

- Phase 4 commit U3 (`a954d2e`)
- `docs/solutions/billing/nestjs-stripe-testing-seam.md` — the Stripe analog; its "Where to apply" section predicts this pattern: "replace 'Stripe' with 'Twilio,' 'Sendgrid,' 'S3,' etc."
- `docs/solutions/architecture-patterns/webhook-reconciliation-guard.md` — the auto-refund complement (refundDeadRequest runs after commit, same never-throw discipline)
