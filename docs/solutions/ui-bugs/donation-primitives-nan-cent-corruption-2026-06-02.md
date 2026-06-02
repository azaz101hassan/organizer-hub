---
title: "Donation UI primitives: NaN/Infinity and fractional-cent corruption in ARIA, display, and form inputs"
date: 2026-06-02
category: docs/solutions/ui-bugs
module: donation UI primitives
problem_type: ui_bug
component: payments
symptoms:
  - "aria-valuenow=\"NaN\" rendered on ProgressBar when valueCents or targetCents is non-finite"
  - "Fill span collapses to zero width with style=\"width: NaN%\" and no visible error"
  - "Literal \"NaN days left\" displayed on CampaignCard when deadline is an empty or unparseable string"
  - "Hidden amountCents form input carries the wrong integer when donor enters fractional-cent dollar amounts (Math.round(1.005 * 100) === 100)"
root_cause: missing_validation
resolution_type: code_fix
severity: high
related_components:
  - documentation
tags:
  - nan-guard
  - aria-accessibility
  - currency-rounding
  - float-math
  - input-validation
  - react-components
  - donations
  - data-integrity
---

# Donation UI primitives: NaN/Infinity and fractional-cent corruption in ARIA, display, and form inputs

## Problem

Three shared React UI primitives in `packages/web-shared/src/ui/` allowed non-finite or malformed numeric values to flow unchecked into ARIA attributes, rendered strings, and form fields. User-visible impact ranged from screen readers announcing a broken progressbar to donors being silently undercharged by a cent because of float-rounding on fractional-cent inputs.

## Symptoms

- `aria-valuenow="NaN"` emitted on `<div role="progressbar">` — screen readers announced "NaN percent" or treated the control as broken; the `<span>` fill had `style="width: NaN%"` and rendered as zero width with no visual cue.
- The string `"NaN days left"` appeared in the rendered `CampaignCard` footer whenever the campaign API returned `deadline: ""` or any other unparseable date string (e.g. `"not-a-date"`, malformed ISO `"2026-13-40"`).
- A donor entering `1.005` in the custom-amount field was charged $1.00 instead of $1.01 — the hidden form input read `amountCents=100`, off by one cent, with no error surfaced and no indication that rounding had occurred.
- No browser console errors in any of the three cases; the bugs were silent by nature.
- Automated unit tests all passed. The test suite covered happy-path finite inputs and whole-dollar amounts, so none of the failure modes tripped a CI gate.

## What Didn't Work

- **Coercion-based guards.** `if (NaN)`, `if (!valueCents)`, and `isNaN(x)` all share the same shape and all fail for the same reason: they conflate "value missing or zero" with "value is not finite." `NaN` is falsy, so `if (!valueCents)` fires for `NaN` — but it also fires for a legitimately-zero progress bar. `Infinity` and `-Infinity` are truthy, so the same guard silently lets them through. The global `isNaN(x)` adds its own coercion semantics on top — `isNaN("")` is `true`, `isNaN(null)` is `false` — which makes it unreliable as a numeric-domain check. None of these are the right shape for "is this a finite number?"
- **`if (valueCents == null)` guard.** `NaN == null` is `false`, so this silently passes `NaN` through. Null-checks are not numeric-validity checks.
- **Adding decimal precision to `Math.round`.** `Math.round((parsed * 100) * 1000) / 1000` does not fix the float-rounding bug. The float representation of `1.005` is already `1.0049999999999999` before any multiplication is applied. No chained multiply-and-divide corrects the initial loss of precision; the error lives in the float representation of the input string, not in the rounding call.

## Solution

`packages/web-shared/src/ui/data/ProgressBar.tsx` — clamp non-finite inputs at the top of the component before any arithmetic:

```ts
export function ProgressBar({ valueCents, targetCents, label }: ProgressBarProps) {
  const safeValue = Number.isFinite(valueCents) ? valueCents : 0;
  const safeTarget =
    Number.isFinite(targetCents) && targetCents > 0 ? targetCents : 0;
  const ratio =
    safeTarget === 0 ? 0 : Math.min(1, Math.max(0, safeValue / safeTarget));
  const pct = Math.round(ratio * 100);
  return (
    <div className="progress" role="progressbar" aria-label={label}
         aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span data-testid="progress-fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
```

`packages/web-shared/src/ui/donations/CampaignCard.tsx` — `daysLeft` returns `number | null` on invalid input; the consumer carries the `null` outward and skips the deadline tail rather than rendering `NaN`. The consumer's outer null-guard is for the prop's own `string | null` shape; the helper's internal guard is for malformed-but-non-null date inputs:

```ts
function daysLeft(deadline: Date | string): number | null {
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil((ms - Date.now()) / 86_400_000));
}

// in the consumer (prop is `Date | string | null`):
const days = deadline !== null ? daysLeft(deadline) : null;
const deadlinePart =
  days === null ? null : days === 1 ? "1 day left" : `${days} days left`;
```

`packages/web-shared/src/ui/donations/DonatePanel.tsx` — string-based cent parser that never calls `Math.round(x * 100)`:

```ts
function parseCustomCents(raw: string): number | undefined {
  const match = raw.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return undefined;
  // match[1] is always a non-empty digit string when the regex matches; the
  // ?? "0" fallback only satisfies noUncheckedIndexedAccess. match[2] is
  // genuinely undefined when the input has no decimal portion.
  const intPart = match[1] ?? "0";
  const fracPart = (match[2] ?? "").padEnd(2, "0");
  const cents = parseInt(intPart, 10) * 100 + parseInt(fracPart, 10);
  return cents > 0 ? cents : undefined;
}
```

The regex rejects scientific notation (`1e3`), more than two decimal places (`1.005`), non-numeric prefixes (`$25`), internal whitespace, and empty strings. Integer and fractional digit groups are parsed separately and combined as integers — floating-point representation never enters the cents path.

The same file also adds a sanitize-at-init helper for the `defaultAmountCents` prop. It conflates two concerns by design: a numeric-domain check (must be a safe integer — `Number.isSafeInteger` rules out `NaN`, `Infinity`, fractional values, and integers outside the IEEE-754 safe range) and a domain rule (must meet the minimum donation amount). Callers reusing this pattern for their own component should adjust `MIN_CENTS` to their own minimum:

```ts
function sanitizeInitialChip(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  // Numeric guard: rules out NaN, Infinity, non-integers, unsafe integers.
  if (!Number.isSafeInteger(value)) return undefined;
  // Domain rule: enforce the minimum donation amount.
  if (value < MIN_CENTS) return undefined;
  return value;
}
```

so a malformed prop (`NaN`, `Infinity`, `2500.5`, `1e300`, or `50` cents which is below the $1 minimum) cannot seed the `useState` initialiser with bad state. The hidden `amountCents` input serialises empty string when the computed amount is non-finite, so a malformed value cannot leak to the server as the literal string `"NaN"`.

## Why This Works

`Number.isFinite` is the correct primitive for a numeric-domain invariant. Unlike the global `isNaN`, it does not coerce its argument: `Number.isFinite("5")` is `false`, `Number.isFinite(null)` is `false`, and `Number.isFinite(NaN)` is `false`. It returns `true` only for finite IEEE-754 doubles — every representable integer and decimal, including `0` and negative values. This makes it safe at a component boundary: if a prop typed `number` is `NaN` or `Infinity` at runtime, `Number.isFinite` catches it regardless of how it arrived.

The fixes are correct for slightly different reasons:

- **ProgressBar**: Clamping to safe values at prop ingestion means the ARIA attribute, the ratio arithmetic, and the `style` width all operate on a verified-finite number. The clamped `0` is a meaningful, accessible "no progress" value rather than a silent corruption. Note that the server-side `Campaign.raisedCents` aggregate is allowed to go negative in certain dispute-redelivery + refund scenarios (session history) — the `Math.max(0, …)` clamp on `ratio` ensures the UI normalises to `0` in that case rather than displaying a negative fill or a backwards bar. Don't assume the server upper-bounds these aggregates; defending in the primitive is cheaper than auditing every API.
- **CampaignCard**: `Date.getTime()` returning `NaN` for unparseable strings is a stable, documented ECMAScript behaviour, not a browser quirk. Placing the `Number.isFinite(ms)` check at the `daysLeft` helper boundary is the right gate: one check at the point of conversion, `null` propagated outward, consumer decides whether to render or skip. This is more reliable than validating the input string — string-based date validation is underspecified and locale-dependent.
- **DonatePanel**: `Math.round(parseFloat(value) * 100)` is structurally unsound for monetary input because IEEE-754 cannot represent all decimal fractions exactly, and the error is already present in the float before `Math.round` is called. The string-based parser bypasses this by treating the integer and fractional parts as text, converting them to integers separately, and assembling cents without any floating-point multiplication. The result is exact for every two-decimal-place value a donor can type.

Two related architectural facts from the server side anchor these guards (session history):

- `PaymentEvent.amountCents` is a Prisma `Int` column. The wire format is a JSON integer, so `NaN` and `Infinity` cannot originate from the API response itself — they can only be introduced by client-side arithmetic (e.g. dividing one aggregate by another before the response loads, or computing a percentage when a goal has not yet been set). The guards therefore live at the *consumer* of the integer, not at the deserialisation boundary.
- `Donation.canceledAt` and `Donation.currentPeriodEnd` are Prisma `DateTime` (ISO 8601 strings in JSON). No server-side timezone normalisation, format validation, or guarantee of validity beyond "Prisma serialised it" was introduced in Phases A–E. The UI primitive layer is the first place this contract is exercised, which is why an empty-string deadline arriving at `CampaignCard` is plausible and must be defended against.

## Prevention

- **`Number.isFinite` as a primitive-level invariant.** Any component or helper that accepts a `number` prop driving visual output, ARIA state, or a form field value should gate with `Number.isFinite(x)` at the earliest point — typically before the first arithmetic expression. TypeScript's `number` type cannot exclude `NaN` or `Infinity`: both satisfy `typeof x === "number"` and are assignable to `number` at the type level, so the type checker cannot distinguish finite from non-finite within the `number` domain. The runtime guard is always necessary at component-prop ingestion points.

- **`Number.isSafeInteger` for integer-cent props.** Use `Number.isSafeInteger` (not `Number.isInteger`) anywhere a cents value is going to be serialised as a form integer or fed into integer arithmetic. `Number.isInteger(1e300)` returns `true` because the value is representable as a whole-number IEEE-754 double, but `1e300` is well outside the safe range and will overflow downstream. `Number.isSafeInteger` rejects `NaN`, `Infinity`, fractional values, and integers outside `[-2^53+1, 2^53-1]` in a single call.

- **String-based cent parsing for money input.** Whenever a donor or administrator types a monetary amount, parse it with a regex that extracts integer and fractional digit groups and combines them as integers. Never use `Math.round(parseFloat(value) * 100)`. The regex-and-integer approach is exact; the float-multiply approach is not.

- **Null-returning temporal helpers.** Date-derived display values (days remaining, time since, countdown) should live in a named helper that returns `number | null`, not `number`. The helper checks `Number.isFinite(d.getTime())` immediately after constructing the `Date`, returns `null` on failure, and the consumer decides whether to render a fallback or omit the element. Do not propagate `NaN` downstream through arithmetic.

- **Regression test patterns for numeric edge cases.** For every component that accepts a `number` prop or a string-typed date or money input, the test file should include at least one case for each of: `NaN`, `Infinity`, `""` (empty string), `"not-a-date"` (or similar invalid-date input), and a sentinel fractional-cent value (`"1.005"`). These tests codify the guard contract. If a future contributor weakens a `Number.isFinite` guard or reverts to `Math.round(x * 100)`, at least one of these tests fails immediately.

- **Sanitize-at-init for "default" props.** Hidden form fields that could emit `"NaN"` should serialise to `""` if their source value is non-finite, not forward the `NaN` string to the server. Likewise, `useState(defaultX)` initialisers should accept a sanitiser that returns `undefined` for malformed defaults — keeping bad state from seeding the first render.

## Related Issues

- `docs/solutions/architecture-patterns/webhook-reconciliation-guard.md` — server-side guard pattern for the `amountCents` integers that this primitive layer eventually feeds. A reader fixing a UI display bug here may need to confirm that the underlying aggregate is correct on the server before patching the view.
