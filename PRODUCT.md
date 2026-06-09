# Product

## Register

product

## Users

Event-goers and community members who have registered accounts. They access the dashboard to manage their membership, browse and request tickets, and review their payment history. Primary context: desktop or mobile, after logging in, task-oriented.

## Product Purpose

Organizer Hub is a unified platform for event organizers and their members. The member app gives registered users a personal dashboard to track their membership status, ticket requests, and payment history. Success means members can self-serve all account questions without contacting support.

## Brand Personality

Editorial, considered, premium. The product is a pane of glass over event
organizers and their members — confident enough to take the visual lead,
quiet enough to defer to the evenings on the calendar.

One cohesive theme ships in two modes. **Light mode** is a pure-white
gallery — high contrast, open, editorial. **Dark mode** is blue-black dusk
— deep navy shadows, the same deep-cobalt accent reads as a luminous steel
blue, Spectral as the display serif carries equal weight in both. Mode
follows the system by default; users can pin Light or Dark per browser. A
mode switch flips tokens, never layouts.

## Anti-references

- Stock Tailwind out of the box — zinc-only neutrals, generic blue actions,
  Arial-fallback typography.
- Unbranded `create-next-app` shells with default favicons and metadata.
- Hard-coded color values, fonts, or radii in component JSX — the token
  layer is the only legitimate place those live.
- Mixing UI primitives between apps by copy-paste — primitives live in
  `packages/web-shared/src/ui/`.

## Design Principles

1. **One token contract.** Color, type, radius, motion, and shadow are
   declared in CSS variables. Pages reference tokens (`bg-surface`,
   `text-ink`, `rounded-btn`), never literals.
2. **Clarity first.** Every screen answers one question for its viewer.
   Hierarchy is established by type ladder (display / eyebrow / lede / body
   / muted / faint / mono), not by box decoration.
3. **Data over decoration.** Lists, tables, and data panels are first-class.
   The admin app is a control room; the member app is a calendar.
4. **Accessible by default.** WCAG AA contrast in both light and dark modes
   (every text/bg pair ≥4.5:1, body ink ≥7:1). Visible focus rings on every
   interactive element. `prefers-reduced-motion` respected.
5. **Compose, don't fork.** New variants extend a primitive; three forked
   variants is the signal to refactor, not to add a fourth.

## Accessibility & Inclusion

WCAG AA (4.5:1 body text, ≥7:1 for primary ink). Light and dark modes follow the system preference by default; users may pin either mode. Reduced motion respected.
