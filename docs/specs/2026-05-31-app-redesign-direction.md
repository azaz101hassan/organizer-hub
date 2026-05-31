# App Redesign — Direction & System

**Date:** 2026-05-31
**Status:** Draft, awaiting review
**Scope:** `apps/member` and `apps/admin`

## Context

The current member and admin apps use stock Tailwind utilities (zinc + blue), no
custom token system, no shared UI primitives, no branded login, no shared
wordmark, and a body font-family rule leftover from `create-next-app` that
overrides the loaded Geist variables. PRODUCT.md describes the current visual
target as "clear, trustworthy, functional. Confident but not flashy" — that
direction has produced an app that reads as a prototype, not a product.

A premium visual direction was prototyped outside the repo (HTML/CSS/JSX
sketches with three theme variants). This spec ports that direction into the
real codebase as the new visual system and supersedes the PRODUCT.md "Brand
Personality" and "Design Principles" sections. The reference is a starting
point, not a freeze: the token architecture and primitives are designed so
future visual iteration is cheap.

## Goals

1. Establish a shared design token system (color, type, radius, motion,
   shadow) consumed by both apps via Tailwind v4's `@theme` directive and a
   `[data-theme]` selector for theme switching.
2. Ship three coherent themes — **Atrium** (editorial ivory + brass serif),
   **Noir** (cinematic near-black + amber grotesque), **Vellum** (warm paper
   + deep forest soft serif) — all sharing the same component vocabulary.
3. Extract a small set of reusable UI primitives into `packages/web-shared`
   so each app composes screens from the same building blocks.
4. Redesign every member-facing route (landing, events, event detail,
   membership, sign-in landing, attendee dashboard, payments).
5. Redesign the admin shell as a topbar + sidebar control room with proper
   data tables, KPI cards, charts, an activity feed, and a live waitlist
   queue.
6. Replace the unbranded `create-next-app` shell (title, favicon, body
   font-family override) with a branded one.
7. Update PRODUCT.md to reflect the new visual direction.

## Non-goals

- **No changes to payment plumbing.** The Stripe redirect flow (membership
  Checkout, ticket Checkout, the webhook → `PaymentEvent` ledger) stays as-is.
  The reference shows an in-app checkout modal; production keeps the
  redirect-to-Stripe.
- **No new data models.** The redesign ports visual layer only. The
  organizer-side dashboards in the admin app render data the API already
  exposes (events, ticket types, requests, payment events, memberships).
  Members/orders/analytics widgets that the reference shows against mock data
  map onto existing endpoints (`/admin/payment-events`, `/admin/requests`,
  `/admin/events`, `/admin/memberships`) — gaps documented in the per-screen
  mapping table below.
- **Donation flow.** Deferred. The previous brainstorm on `kind = DONATION`
  resumes once this redesign is the established baseline.
- **OIDC sign-in flow.** Stays as a route handler that redirects to the IdP.
  A new pre-redirect landing page provides the branded surface (see
  member screen mapping).
- **CMS / content modeling.** The reference uses prose-heavy mock copy
  ("societies of consequence", chamber music, salons). Real copy continues
  to come from the API; design tokens make any tone work.

## Design system

### Three themes, one vocabulary

| Theme | Default for | Surface | Ink | Accent | Display font | Body font | Radius scale |
|---|---|---|---|---|---|---|---|
| Atrium | Member app | Ivory `#f1ece1` | `#211d16` | Brass `#9c6a39` | Cormorant Garamond | Hanken Grotesk | 3 / 6 / 10 px |
| Noir | Admin app | Near-black `#100e0b` | `#f2ebdd` | Amber `#d9a44b` | Space Grotesk | Hanken Grotesk | 2 / 4 / 6 px |
| Vellum | (alternate) | Warm paper `#e7e2d5` | `#1e231d` | Forest `#2f5c47` | Spectral | Hanken Grotesk | 16 / 22 / 999 px |

All three themes share Hanken Grotesk for body, Spline Sans Mono for numbers,
the same iconography, the same component vocabulary, and the same
interaction patterns. Theme switch is one attribute (`<html data-theme="...">`)
and produces no layout shift.

### Token namespace

CSS variables defined under `:root` (Atrium default) with full overrides
under `[data-theme="noir"]` and `[data-theme="vellum"]`. The reference's
`styles.css` is the authoritative source for the initial values; we lift
the whole token block verbatim and re-export through Tailwind v4 `@theme`.

**Surface & ink:** `--bg`, `--surface`, `--surface-2`, `--ink`, `--muted`,
`--faint`, `--line`, `--line-strong`.
**Accent:** `--accent`, `--accent-2`, `--accent-on`, `--accent-soft`.
**Semantic state:** `--good`, `--good-soft`, `--warn`, `--warn-soft`,
`--bad`, `--bad-soft`.
**Radius:** `--radius`, `--radius-lg`, `--btn-radius`, `--chip-radius`.
**Type:** `--font-display`, `--font-body`, `--font-mono`,
`--display-weight`, `--display-tracking`, `--display-lh`,
`--eyebrow-tracking`.
**Depth:** `--shadow`, `--shadow-lg`.
**Texture:** `--grain-opacity` (controls film-grain mix on poster art).

Per-user accent overrides (Brass, Amber, Forest, Wine) and corner-radius
overrides (Sharp / Default / Soft) are exposed but ship hidden behind a
developer-only flag for v1. The architecture allows them; the v1 product
does not surface them.

### Tailwind v4 mapping

The shared CSS lives in `packages/web-shared/src/ui/tokens.css` and is
imported once per app from `globals.css`. Tailwind v4 `@theme inline` maps
each CSS variable to a Tailwind token namespace so utilities resolve
theme-aware:

```css
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-ink: var(--ink);
  --color-muted: var(--muted);
  --color-faint: var(--faint);
  --color-line: var(--line);
  --color-line-strong: var(--line-strong);
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --color-accent-soft: var(--accent-soft);
  --color-accent-on: var(--accent-on);
  --color-good: var(--good);
  --color-warn: var(--warn);
  --color-bad: var(--bad);
  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);
  --radius-sm: var(--radius);
  --radius-lg: var(--radius-lg);
  --radius-btn: var(--btn-radius);
}
```

Result: `bg-surface`, `text-ink`, `text-muted`, `border-line`,
`text-accent`, `font-display`, `rounded-btn`, etc. all work in the
existing Tailwind class style and re-resolve when `data-theme` flips.

### Typography ladder

| Class / role | Family | Weight | Tracking | Use |
|---|---|---|---|---|
| `.display` | Display | 500-700 | -0.025 to -0.01em | Page titles, hero, card titles |
| `.eyebrow` | Body | 600 | 0.2-0.26em uppercase | Kicker labels, table headers |
| `.lede` | Body | 400 | normal | Hero paragraphs, key descriptions |
| body | Body | 400-500 | normal | Default text |
| `.muted` / `.faint` | Body | inherit | inherit | Secondary text |
| `.mono` | Mono | 400-500 | normal | Money, IDs, timestamps |

### Motion

- All entrance reveals use `transform`, never `opacity`. Background-tab
  throttling pauses CSS timelines, so an opacity-based reveal locks content
  invisible in backgrounded tabs. This is the lesson the reference learned
  the hard way; we encode it as a rule.
- Standard transition: `cubic-bezier(0.2, 0.9, 0.3, 1)`, 180-300ms.
- Respect `prefers-reduced-motion`: skip the reveal animation entirely,
  keep hover and focus transitions.

### Accessibility floor

- WCAG AA contrast on every theme/body combination. Atrium ivory + brass
  passes; Noir dark + amber passes; Vellum forest + paper passes. New
  custom-accent combinations must be checked.
- Focus rings: `box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)` on every interactive element via `.input:focus`, button `:focus-visible`, etc.
- Reduced motion respected (see above).
- Reduced transparency not respected (`backdrop-filter: blur(...)` is used
  in the public nav and admin topbar); document and accept.

## Component primitives

Ship in `packages/web-shared/src/ui/`. Each is a focused React component
that consumes design tokens and exposes a typed prop surface. The goal is
that any page composes from these — no inline Tailwind walls.

| Primitive | Props (highlights) | Notes |
|---|---|---|
| `<Button>` | `variant: primary \| solid \| ghost \| quiet \| danger`; `size: sm \| md \| lg`; `block` | Renders `<button>` or `<a>`; honors `disabled` |
| `<Chip>` | `tone: default \| accent \| muted`; `active`, `onClick` | Pill-style filter or label |
| `<Badge>` | `tone: owner \| admin \| member \| published \| draft \| cancelled` | Static role/status indicator |
| `<Card>` | `as`, `padding`, `border`, `hoverable` | Surface wrapper |
| `<Field>` + `<Input>` + `<Textarea>` + `<Select>` | label + helper + error | Form atom set |
| `<Modal>` | `open`, `onClose`, header/body/footer slots | Scrim + reveal animation |
| `<Toast>` | global instance + `useToast()` hook | Bottom-center, ink-on-bg |
| `<Poster>` | `mood: keyof OH_MOODS`, `label`, `monoSize` | Signature duotone+grain art used for events, memberships, sign-in hero, dashboard thumbs |
| `<Eyebrow>`, `<Lede>`, `<Display>` | typed text components | Enforce type scale without ad-hoc utilities |
| `<NavLink>` | `active`, `onClick`/`href` | Top nav text link |
| `<NavItem>` | `icon`, `label`, `active`, `badge` | Sidebar item |
| `<Avatar>` | `name`, `size`, `mood?` | Initials avatar with token-aware bg |
| `<StatusBadge>` | `status: PUBLISHED \| DRAFT \| CANCELLED` | Specialized of `<Badge>` |
| `<Pill>` | `tone: paid \| pending \| refunded \| active \| lapsed` | Admin-table state pill (smaller than badge) |
| `<Icon>` | `name`, `size` | 1.6-stroke SVG set; lifted verbatim from reference `lib.jsx`, extended for admin (search, refresh, dollar, card, pie, mail, filter, dots, trendUp/Down, home, arrowUpRight, cal2) |

**Admin-specific** (live alongside the above, in the same package):

| Primitive | Notes |
|---|---|
| `<KpiCard>` | Vertical KPI: icon, trend chip, value, sparkline |
| `<Panel>` + `<PanelHead>` + `<PanelBody>` | Bordered content section with title row |
| `<DataTable>` | Thin wrapper around `<table.tbl>`: header cells, num column, hover rows, row click, `<DotMenu>` action cell |
| `<Toolbar>` + `<Segmented>` | Filter bar above tables |
| `<BarChart>` | Hover tooltip; no library, ~70 lines SVG |
| `<Donut>` | SVG arc; no library, ~30 lines |
| `<Sparkline>` | Polyline; up/down color |
| `<Trend>` | `delta`, `suffix` — colored up/down indicator |
| `<Progress>` | Horizontal capacity bar |
| `<FeedItem>` | Activity-feed row with kind-keyed icon palette |

**Non-goals for primitives:** no theme provider context, no React Context
for tokens (the CSS variable selector model does this), no compound components
beyond what's listed, no Radix/Headless UI dependency unless a real
accessibility need surfaces.

## App-level layout shells

### Member app shell

Two shells live in `apps/member/src/components/`:

**`<PublicShell>`** — wraps unsigned routes (`/`, `/events`, `/events/[id]`,
`/membership`, `/auth/login`). Sticky blurred `<nav.pubnav>` with brand on
left, route links on right, sign-in/sign-out CTA. Footer with brand + tagline.

**`<DashShell>`** — wraps signed-in routes (`/dashboard`, `/dashboard/*`).
248-wide `<aside.dash__side>` sidebar with: brand at top, NavItem stack
(Overview, My membership, My requests, Payments), org affiliations as
read-only chips, user card with sign-out at bottom. Sticky to viewport.
`<main.dash__main>` at 1000px max.

The reference's organizer-side dashboard ("Organizing" section, OrgPage,
EventEditor, NewEvent, WaitlistQueue) does **not** live in `apps/member`.
Those are admin concerns, ported to `apps/admin`.

### Admin app shell

`<AdminShell>` in `apps/admin/src/components/`. CSS grid:
`grid-template-areas: "brand top" "side main"`, columns `256px 1fr`,
rows `64px 1fr`.

- **`<BrandCorner>`** — top-left. Wordmark + "Admin" tag chip.
- **`<TopBar>`** — search input (placeholder ⌘K), spacer, refresh button,
  notification button with unread dot, divider, user menu trigger.
  Dropdown menus (notifications panel, user menu) render absolute-positioned
  beneath the trigger.
- **`<Sidebar>`** — grouped nav: **Overview** (Dashboard, Analytics), **Manage**
  (Events, Waitlist, Orders), **People** (Members), then Settings, then an
  org switcher card at the bottom.
- **`<Main>`** — content. Each screen starts with `<PageHead>` (breadcrumb,
  title, sub, actions slot).

Sidebar collapses to 64px icon-only at viewport ≤ 1100px. KPI grid
collapses to 2×2 at ≤ 1240px.

## Screen inventory & port mapping

### Member app

| Route | Current state | New design | Notes |
|---|---|---|---|
| `/` | Centered card, "Sign in" CTA | Editorial landing: hero (eyebrow + display + lede + CTAs + stats row) + featured-3 grid + membership band + footer | New marketing-style home |
| `/events` | Bordered `<ul>` rows | Filter chips strip + 3-up `<EventCard>` grid with poster art | Existing label filter becomes filter chips |
| `/events/[id]` | Bordered ticket rows | Hero poster + sticky card overhang (-120 mt) with facts, blurb, ticket list, AttendeeTicket rows | Sticky overhang requires the poster behind |
| `/membership` | 3-col bordered cards | 3-col pricing cards with crown icon, perks list, featured-tier emphasis | `subscribeToTier` Server Action unchanged |
| `/auth/login` | (route handler only — no UI) | Split screen: full-height poster on left, branded sign-in form on right with email/password fields → posts to existing OIDC route handler | Pre-redirect surface for the OIDC flow |
| `/dashboard` | 4-up stat cards | DashShell + stats grid + "Your tickets / upcoming evenings" list | Stat content stays semantic; replace zinc cards with `<KpiCard>` |
| `/dashboard/membership` | Detail card | DashShell + poster header + key/value list + change-tier / cancel actions | Existing `<CancelButton>` keeps its behavior |
| `/dashboard/requests` | `<ul>` rows | DashShell + grouped request list with `<Pill>` status and contextual actions | API unchanged |
| `/dashboard/payments` | 4-col fixed grid rows | DashShell + `<DataTable>` with date / description / status / amount columns | API unchanged; admin transactions screen is a richer version of the same |

### Admin app

| Route | Current state | New design | Notes |
|---|---|---|---|
| `/dashboard` | (current state TBD — verify) | KPI row (revenue, tickets, members, requests) + revenue bar chart + category donut + activity feed + upcoming events panel | New screen |
| `/analytics` | (does not exist) | Monthly revenue chart, tier donut, top-events-by-revenue list | New screen; API gaps documented below |
| `/events` | (varies) | Toolbar (segmented status filter + search + filters) + `<DataTable>` with capacity bars, revenue column, dot-menu actions | Existing event endpoints |
| `/waitlist` | (replaces / consolidates queue surfaces) | `<PageHead>` with live indicator + pending chip + flash notification + grouped `<RequestRow>` panels per event | Existing `/admin/requests` endpoint |
| `/orders` (or `/transactions`) | Existing `/transactions` table | 3-up mini-stat row + segmented status filter + `<DataTable>` with status pills | Repaint existing screen; same `/admin/payment-events` endpoint |
| `/members` | (does not exist) | Tier segmented filter + search + `<DataTable>` with avatar, tier badge, status pill, society, events count, lifetime spend, joined date | Needs new API endpoint or extension of `/admin/memberships` — flagged as open |
| `/settings` | (varies) | Vertical-tab nav (Organization / Branding / Team / Billing) with form panels | Branding tab exposes theme switcher for portfolio demo |

**Pre-existing admin screens to verify before final plan:** `/admin/dashboard`,
`/admin/events`, `/admin/event-labels` (already exists per the
`a3b630d feat: split apps/member + apps/admin with EventLabel CRUD` commit).
The implementation plan will inventory exactly which admin routes exist
today and pair the redesign with each.

### API gaps for admin

The reference's mock data includes shapes the production API does not yet
return: per-event aggregate revenue, lifetime member spend, 12-month
revenue series, category breakdown, tier breakdown, activity feed,
notifications. For v1 we ship the visual layer against the data the API
currently provides; missing widgets render skeleton-states or a
"coming soon" affordance, **not** mock data. Each gap becomes a follow-on
plan item (API endpoint + DTO + read service).

Specifically:
- **Activity feed:** can be assembled from existing `PaymentEvent` rows
  for v1 (kind, amount, who, what, when) — no new endpoint needed.
- **Revenue series / category split / tier split / per-event revenue /
  per-member lifetime spend:** all derivable from `PaymentEvent` +
  `Membership`. We need either a new `/admin/analytics` endpoint or
  client-side aggregation over the existing payment-events list.
  Recommendation: a new aggregation endpoint, deferred to a follow-on plan.
- **Notifications:** no existing source. Defer to a follow-on; for v1 the
  notification panel is a polished empty state.

## Architectural decisions

### Where the system lives

```
packages/web-shared/src/ui/
├── tokens.css           # all CSS variables + @theme mapping
├── tokens.theme.atrium.css   # data-theme="atrium" overrides
├── tokens.theme.noir.css     # data-theme="noir"   overrides
├── tokens.theme.vellum.css   # data-theme="vellum" overrides
├── primitives/          # Button, Card, Chip, Badge, Field, Input, etc.
├── poster/              # Poster, OH_MOODS, grain texture
├── nav/                 # NavLink, NavItem, NavGroup
├── data/                # DataTable, Toolbar, Segmented, Pill, Trend
├── charts/              # BarChart, Donut, Sparkline, Progress
├── overlays/            # Modal, Toast (and useToast hook)
└── index.ts             # barrel
```

Each app's `globals.css` becomes:
```css
@import "tailwindcss";
@import "@organizer-hub/web-shared/ui/tokens.css";
@import "@organizer-hub/web-shared/ui/tokens.theme.atrium.css";
@import "@organizer-hub/web-shared/ui/tokens.theme.noir.css";
@import "@organizer-hub/web-shared/ui/tokens.theme.vellum.css";
/* app-specific overrides, if any */
```

The body's `font-family: Arial, Helvetica, sans-serif` line currently in
`apps/member/src/app/globals.css` gets deleted.

### Default themes & switching

- Member app: `data-theme="atrium"` by default. User preference stored in a
  `oh_member_theme` cookie or `localStorage` (TBD per implementation plan).
  Switcher exposed in dashboard settings (member side) — the cookie path
  survives SSR; localStorage requires a script to apply before hydration to
  avoid a flash.
- Admin app: `data-theme="noir"` by default. Same switching mechanism. The
  Settings → Branding tab exposes the switcher with theme previews
  (poster swatches).

For SSR-safe theme application: write the theme to `<html data-theme>`
from a server-rendered cookie at request time. If the cookie is absent,
use the app's default. Client-side switching updates both cookie/storage
and the DOM attribute synchronously.

### Client/server boundary

- Token CSS and `<html data-theme>` resolution: **server**. Set on
  `<html>` from `apps/member/src/app/layout.tsx` and
  `apps/admin/src/app/layout.tsx` based on cookie.
- Server components keep doing data fetching (`apiFetch`, `publicApiFetch`).
- Primitive components in `packages/web-shared/src/ui/` are **server-safe
  by default** (no hooks, no event handlers). Variants that need
  interactivity (`<Modal>`, `<Toast>`, `<Segmented>`, theme switcher,
  org switcher, user menu, search input, table dot-menu, charts with
  hover tooltips) are explicitly marked `"use client"`.
- The reference uses heavy inline `style={{ }}` props. For the port, we
  prefer Tailwind utilities + CSS classes from `tokens.css`; inline styles
  only where they encode dynamic values (`width: pct + "%"`, `mood`
  poster variables).

### Iteration architecture

The user has flagged that this is a **starting point** and the design will
keep evolving. Three rules to make iteration cheap:

1. **No design decisions in business logic.** Components in
   `packages/web-shared/src/ui/` receive primitives and emit JSX. They do
   not decide what data to fetch, what to label things, or what to do on
   click — callers do that. A re-skin replaces the primitives, not the
   pages.
2. **Tokens are the only shared visual contract.** Pages reference tokens
   (`bg-surface`, `text-ink`, `rounded-btn`) and never hard-code hex,
   px-radius, or font-family. A new theme is a new `tokens.theme.*.css`
   file plus an entry in the switcher.
3. **Compose, don't fork.** When a new variant is needed (a new ticket
   row style, a new event card), add a prop to the existing primitive
   rather than forking. If three variants accumulate, that's the time to
   refactor into a smaller, more atomic primitive.

## PRODUCT.md update

The current PRODUCT.md describes:
> Brand Personality — Clear, trustworthy, functional. Confident but not
> flashy. Designed to get out of the way and let members focus on events,
> not UI.
> Anti-references — Overly flashy SaaS dashboards with gradient blobs and
> hero metrics. Heavy animation for its own sake. Marketing-page aesthetics
> bleeding into the app shell.
> Design Principles — Clarity first, consistency (zinc neutrals, rounded-2xl
> cards, blue action links — the same patterns across every route), data
> over decoration.

Replace with a section that:
- Names the three themes and their roles (member default, admin default,
  alternate).
- Reframes "consistency" as "shared token system with theme variants" and
  removes the zinc-blue specifics.
- Keeps "Clarity first" and "Data over decoration" as principles — both
  survive the new direction, especially in the admin tables.
- Replaces the anti-reference (the new design is the editorial/premium
  direction the old anti-reference warned against; instead, anti-references
  become "Bootstrap-default look", "stock Tailwind without tokens",
  "unbranded create-next-app shells").
- Keeps WCAG AA, reduced-motion, dark-mode-by-system as accessibility floors
  (Noir doubles as system-dark for users who want it).

The PRODUCT.md edit ships in the same plan as the system foundation —
the new direction should be the documented direction before the first
screen lands.

## Out of scope

- Donation flow (deferred — resumes after redesign baseline).
- Payment plumbing changes (Stripe redirect flow, PaymentEvent ledger,
  webhook event subscription).
- Schema changes (no new Prisma models).
- OIDC sign-in mechanism (route handler stays; only the pre-redirect
  surface changes).
- Mobile responsive deep-pass beyond the explicit breakpoints called out
  in the reference (1100 / 1240 px). v1 supports modern desktop and
  reasonable tablet; phone-shape audit is a follow-on.
- Admin API expansions for analytics widgets (deferred — v1 ships skeleton
  states for unbacked widgets).
- Localization. Copy is English-only.
- A full icon-system rationalization (we adopt the reference's 1.6-stroke
  SVG set as-is; extending it later is a follow-on).

## Risks & open questions

- **Tailwind v4 `@theme` + cross-package CSS imports.** Need to confirm
  the import order resolves correctly when `tokens.css` lives in
  `packages/web-shared/`. Risk: workspace package CSS doesn't ship through
  Next.js compile by default. Mitigation: validate in the first
  implementation slice; fall back to colocating CSS in each app if needed.
- **Flash-of-unthemed-content on theme switch.** Setting `data-theme`
  from cookie on the server eliminates this for SSR; client-side toggle
  must update synchronously before the next paint. Risk: localStorage
  needs a blocking script in `<head>` to avoid flash.
- **Admin members directory needs an API endpoint.** Implementation plan
  must either add one or scope the Members screen out of v1.
- **Activity feed assembly.** Aggregating from `PaymentEvent` covers most
  events (orders, refunds) but not publish/member-join. Either widen the
  feed sources later or label the v1 feed as "Recent transactions".
- **Theme switcher persistence.** Cookie vs localStorage tradeoff
  decided in the implementation plan; both are workable. Cookie is the
  cleaner SSR story.
- **Stripe Checkout modal.** The reference shows an in-app modal; we
  keep redirect-to-Stripe. Risk: visual continuity drops the moment a
  user lands on `checkout.stripe.com`. Acceptable for v1; Stripe's
  hosted theme can be lightly customized in a follow-on.
- **OrganizerHub wordmark.** The reference uses a 26px square mark
  containing the letter "O" in the display font. We ship that as-is.
  A real logo treatment is a future creative pass.
- **Refining the design after v1.** The user has stated more iteration
  will come. The architecture supports it (tokens + primitives + theme
  files); incoming changes should land as edits to those files, not new
  abstractions.

## Iteration plan (v1 staged rollout)

The implementation plan (next document) will break this work into
ordered, independently shippable slices. Anticipated shape:

1. **Foundation** — branded `<html>`/`<body>`, fonts loaded, body
   font-family override deleted, favicon, metadata, `tokens.css` and
   three theme files in `packages/web-shared`, Tailwind v4 `@theme`
   wired in both apps. PRODUCT.md updated. No visible screen changes yet.
2. **Primitives** — `<Button>`, `<Card>`, `<Chip>`, `<Badge>`, `<Field>`
   set, `<Eyebrow>` / `<Lede>` / `<Display>` text, `<Icon>` set,
   `<Poster>` and `OH_MOODS`. No screens yet; primitives ready.
3. **Member public surfaces** — landing, events list, event detail,
   membership, sign-in landing. Public nav + footer.
4. **Member dashboard** — DashShell, overview, my-membership, my-requests,
   payments. Sidebar with theme switcher.
5. **Admin shell** — AdminShell, BrandCorner, TopBar, Sidebar, PageHead.
   Theme switcher and org switcher functional. No screens beyond a
   stub Dashboard.
6. **Admin dashboard** — KPIs, revenue chart, category donut, activity
   feed (from PaymentEvent), upcoming events panel.
7. **Admin tables** — events, orders, members (or members deferred if
   API gap not yet closed).
8. **Admin waitlist** — live queue from `/admin/requests`.
9. **Admin analytics + settings** — charts, settings tabs, branding tab
   with theme previews.
10. **Polish & QA pass** — focus rings audited, contrast checked, motion
    audited, broken-corner cases (empty states, error states, narrow
    viewports), light-vs-dark theme parity check.

Each slice ships a visual-discipline review of the produced screen against
the reference (hierarchy, type ladder, token usage, motion, focus rings,
contrast, empty/error states).

## References

- **Existing PRODUCT.md** at `/PRODUCT.md` (to be updated).
- **Existing payment-events spec** at
  `docs/specs/2026-05-31-payment-events-ledger-design.md` — establishes
  the spec format used here.
- **External design reference** — HTML/CSS/JSX prototype bundle in two
  versions; member-side design system in version 1, admin shell added in
  version 2. Authoritative for tokens (`styles.css`, `admin.css`),
  primitives (lifted into `packages/web-shared/src/ui/`), and screen
  composition. Not committed to the repo; lives outside as a creative
  source. Each iteration of the design reference produces an updated
  port plan, not a one-shot freeze.
- **Repo:** `https://github.com/azaz101hassan/organizer-hub`
- **Apps:** `apps/member` (Next.js, member-facing), `apps/admin`
  (Next.js, organizer-facing).
