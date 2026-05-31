# App Redesign — Direction (Implementation Plan)

> **For executors:** implement task-by-task. Each unit must be independently
> shippable; verify before committing. Steps use checkbox (`- [ ]`) syntax for
> tracking. Follow the repo's commit conventions: conventional-commit subject
> ≤ 70 chars, blank line, bullet body with one bullet per logical change, no
> co-author or auto-generated trailer.

**Goal:** Replace the stock-Tailwind shells of `apps/member` and `apps/admin`
with a coherent token-driven design system, three themes (Atrium / Noir /
Vellum), shared UI primitives in `packages/web-shared`, and redesigned screens
across both apps.

**Architecture:** CSS variables under `[data-theme]` are the only shared
visual contract. Tailwind v4 `@theme inline` maps them to utility classes that
re-resolve on theme flip. Shared primitives live in
`packages/web-shared/src/ui/`, composed by both apps. Member app defaults to
Atrium; admin app defaults to Noir. Theme stored in an HTTP cookie so SSR
applies the right tokens before hydration.

**Tech stack:** Next.js App Router (RSC + Server Actions), Tailwind v4, React
18, TypeScript, Vitest + `@testing-library/react` for unit/render tests.

**Spec reference:** `docs/specs/2026-05-31-app-redesign-direction.md` —
authoritative for the design system. This plan implements that spec's "iteration
plan (v1 staged rollout)" section as ordered units.

---

## Conventions for every unit

- **One unit = one PR-sized landing.** Each unit produces a working, typechecked
  member app and admin app. If a unit can't be shipped on its own, it's the
  wrong shape — split it.
- **Tests where they pay.** Primitives get render tests (semantic structure,
  variant props). Pure helpers (formatters, mood lookups, poster utilities)
  get unit tests. Screens get typecheck + visual review against the reference
  + manual focus-ring and contrast checks.
- **No forbidden tokens in commits, docs, code, or comments.** See the global
  rule list. Refer to the reference as "external design reference" or "design
  reference bundle"; never name the tool that produced it.
- **Commit after each unit's verification passes.** Match repo conventions
  (bullet body, no trailer, conventional subject).
- **Before each unit:** rebase on `main`, ensure clean working tree.

## File structure (new directories created over the plan)

```
packages/web-shared/src/ui/
├── tokens.css                       # root vars + atrium values (U1)
├── tokens.theme.noir.css            # data-theme="noir" overrides (U1)
├── tokens.theme.vellum.css          # data-theme="vellum" overrides (U1)
├── tokens.layout.css                # public-nav, dash, admin shell CSS (U1, extended in U8)
├── primitives/
│   ├── Button.tsx                   # U2
│   ├── Card.tsx                     # U2
│   ├── Chip.tsx                     # U2
│   ├── Badge.tsx                    # U2
│   ├── Field.tsx                    # U2
│   ├── Input.tsx                    # U2
│   ├── Textarea.tsx                 # U2
│   ├── Select.tsx                   # U2
│   ├── StatusBadge.tsx              # U2
│   └── Pill.tsx                     # U2
├── typography/
│   ├── Display.tsx                  # U2
│   ├── Eyebrow.tsx                  # U2
│   └── Lede.tsx                     # U2
├── icons/
│   ├── Icon.tsx                     # U2
│   └── paths.ts                     # U2 (member icons), U8 (admin icons added)
├── poster/
│   ├── Poster.tsx                   # U2
│   ├── moods.ts                     # U2
│   └── grain.ts                     # U2
├── nav/
│   ├── NavLink.tsx                  # U3
│   └── NavItem.tsx                  # U6, U8
├── overlays/
│   ├── Toast.tsx + useToast hook    # U7 (when first needed)
│   └── Modal.tsx                    # U8 (for admin dropdowns)
├── data/
│   ├── DataTable.tsx                # U10
│   ├── Toolbar.tsx                  # U10
│   └── Segmented.tsx                # U9
├── charts/
│   ├── BarChart.tsx                 # U9
│   ├── Donut.tsx                    # U9
│   ├── Sparkline.tsx                # U9
│   ├── Progress.tsx                 # U9
│   └── Trend.tsx                    # U9
├── theme/
│   ├── readThemeCookie.ts           # U1 (server-only)
│   ├── ThemeSwitcher.tsx            # U7 (member side), reused by U12 (admin settings)
│   └── setThemeCookie.ts            # U7
└── index.ts                         # barrel; extended each unit

apps/member/src/components/          # member-only compositions
apps/admin/src/components/           # admin-only compositions
```

## Unit dependency graph

```
U1 (foundation) ── U2 (primitives) ┬── U3 (public shell + landing)
                                   │     └── U4 (events) ── U5 (membership + sign-in)
                                   ├── U6 (dash shell + overview)
                                   │     └── U7 (dash subpages + theme switcher)
                                   └── U8 (admin shell) ── U9 (admin dashboard)
                                                            ├── U10 (admin tables)
                                                            ├── U11 (admin waitlist)
                                                            └── U12 (admin analytics + settings)
                                                                └── U13 (polish + QA)
```

U3–U5 and U6–U7 and U8 can land in parallel after U2. The graph is the
minimum dependency chain; nothing in it is unrelated parallelism for its own
sake.

---

## Unit U1: Foundation — tokens, themes, branded shells, PRODUCT.md

**Goal:** Wire the CSS variable system and three theme files into both apps
through `packages/web-shared`, replace the unbranded `<html>` shell with one
that loads the design fonts, applies `data-theme` from cookie, and ships
branded metadata. Update PRODUCT.md to match the new direction.

**Files:**
- Create: `packages/web-shared/src/ui/tokens.css`
- Create: `packages/web-shared/src/ui/tokens.theme.noir.css`
- Create: `packages/web-shared/src/ui/tokens.theme.vellum.css`
- Create: `packages/web-shared/src/ui/tokens.layout.css`
- Create: `packages/web-shared/src/ui/theme/readThemeCookie.ts`
- Modify: `packages/web-shared/package.json` (add CSS exports + `./theme` entry)
- Modify: `apps/member/src/app/globals.css` (delete Arial override; import tokens)
- Modify: `apps/admin/src/app/globals.css` (same)
- Modify: `apps/member/src/app/layout.tsx` (load reference fonts via `next/font`,
  read theme cookie, set `<html lang data-theme>`, branded metadata)
- Modify: `apps/admin/src/app/layout.tsx` (same; default `data-theme="noir"`)
- Modify: `PRODUCT.md` (rewrite brand personality, design principles,
  anti-references sections)

- [ ] **Step 1: Inventory the existing globals.css and layout.tsx for both apps**

Run:
```bash
cat apps/member/src/app/globals.css
cat apps/member/src/app/layout.tsx
cat apps/admin/src/app/globals.css
cat apps/admin/src/app/layout.tsx
ls packages/web-shared/src/
cat packages/web-shared/package.json
```
Note the existing exports map in `package.json` — the new CSS and theme entries
add to it without removing existing fields.

- [ ] **Step 2: Write `packages/web-shared/src/ui/tokens.css`**

The root selector holds the Atrium token defaults. Lift values verbatim from
the design reference's `styles.css`. Include the Tailwind v4 `@theme inline`
block mapping CSS variables to Tailwind color/font/radius namespaces.

```css
/* packages/web-shared/src/ui/tokens.css */
/* OrganizerHub design tokens.
   :root holds Atrium defaults. [data-theme="noir"] and [data-theme="vellum"]
   override them. Tailwind v4 @theme inline re-exposes each variable as a
   utility-class token so bg-surface, text-ink, rounded-btn etc. resolve
   theme-aware. */

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
  --color-good-soft: var(--good-soft);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);
  --color-bad: var(--bad);
  --color-bad-soft: var(--bad-soft);

  --font-display: var(--font-display);
  --font-body: var(--font-body);
  --font-mono: var(--font-mono);

  --radius-sm: var(--radius);
  --radius-lg: var(--radius-lg);
  --radius-btn: var(--btn-radius);
  --radius-chip: var(--chip-radius);
}

:root,
[data-theme="atrium"] {
  --bg:           #f1ece1;
  --surface:      #fbf8f1;
  --surface-2:    #ece5d6;
  --ink:          #211d16;
  --muted:        #6c6453;
  --faint:        #97907e;
  --line:         #ded5c2;
  --line-strong:  #cfc4ab;
  --accent:       #9c6a39;
  --accent-2:     #80522a;
  --accent-on:    #fbf8f1;
  --accent-soft:  #ece0cd;
  --good:         #4f7a52;
  --good-soft:    #e0ead9;
  --warn:         #a4742a;
  --warn-soft:    #efe3c9;
  --bad:          #9c4f43;
  --bad-soft:     #efd9d2;

  --radius:       6px;
  --radius-lg:    10px;
  --btn-radius:   3px;
  --chip-radius:  999px;

  --font-display: var(--font-cormorant), Georgia, serif;
  --font-body:    var(--font-hanken), system-ui, sans-serif;
  --font-mono:    var(--font-spline-mono), ui-monospace, monospace;

  --display-weight:   600;
  --display-tracking: -0.01em;
  --display-lh:       1.02;
  --eyebrow-tracking: 0.22em;

  --shadow:    0 1px 2px rgba(40,33,20,.05), 0 14px 40px -28px rgba(40,33,20,.5);
  --shadow-lg: 0 2px 4px rgba(40,33,20,.06), 0 40px 80px -40px rgba(40,33,20,.55);
  --grain-opacity: .5;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 16px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
button { font-family: inherit; }
a { color: inherit; text-decoration: none; }
::selection { background: var(--accent); color: var(--accent-on); }
```

- [ ] **Step 3: Write `packages/web-shared/src/ui/tokens.theme.noir.css`**

```css
/* packages/web-shared/src/ui/tokens.theme.noir.css */
[data-theme="noir"] {
  --bg:           #100e0b;
  --surface:      #1a1713;
  --surface-2:    #221e18;
  --ink:          #f2ebdd;
  --muted:        #a39884;
  --faint:        #756c5c;
  --line:         #2c271f;
  --line-strong:  #3a342a;
  --accent:       #d9a44b;
  --accent-2:     #e8bd6e;
  --accent-on:    #16120c;
  --accent-soft:  #2a2317;
  --good:         #7fb682;
  --good-soft:    #1d2a1d;
  --warn:         #d9a44b;
  --warn-soft:    #2a2317;
  --bad:          #d68a7c;
  --bad-soft:     #2c1d18;

  --radius:       4px;
  --radius-lg:    6px;
  --btn-radius:   2px;
  --chip-radius:  999px;

  --font-display: var(--font-space-grotesk), system-ui, sans-serif;
  --font-body:    var(--font-hanken), system-ui, sans-serif;
  --font-mono:    var(--font-spline-mono), ui-monospace, monospace;

  --display-weight:   600;
  --display-tracking: -0.025em;
  --display-lh:       1.0;
  --eyebrow-tracking: 0.26em;

  --shadow:    0 1px 2px rgba(0,0,0,.4), 0 18px 50px -30px rgba(0,0,0,.9);
  --shadow-lg: 0 2px 6px rgba(0,0,0,.5), 0 50px 90px -40px rgba(0,0,0,1);
  --grain-opacity: .85;
}
```

- [ ] **Step 4: Write `packages/web-shared/src/ui/tokens.theme.vellum.css`**

```css
/* packages/web-shared/src/ui/tokens.theme.vellum.css */
[data-theme="vellum"] {
  --bg:           #e7e2d5;
  --surface:      #f4f0e7;
  --surface-2:    #ddd6c5;
  --ink:          #1e231d;
  --muted:        #5d645a;
  --faint:        #8a8f83;
  --line:         #d0c9b7;
  --line-strong:  #c0b8a2;
  --accent:       #2f5c47;
  --accent-2:     #234738;
  --accent-on:    #f4f0e7;
  --accent-soft:  #d7e0d4;
  --good:         #2f5c47;
  --good-soft:    #d7e0d4;
  --warn:         #9a6a2e;
  --warn-soft:    #ece0cb;
  --bad:          #9c4f43;
  --bad-soft:     #ecd7d1;

  --radius:       16px;
  --radius-lg:    22px;
  --btn-radius:   999px;
  --chip-radius:  999px;

  --font-display: var(--font-spectral), Georgia, serif;
  --font-body:    var(--font-hanken), system-ui, sans-serif;
  --font-mono:    var(--font-spline-mono), ui-monospace, monospace;

  --display-weight:   500;
  --display-tracking: -0.015em;
  --display-lh:       1.05;
  --eyebrow-tracking: 0.2em;

  --shadow:    0 1px 2px rgba(30,35,29,.05), 0 16px 40px -28px rgba(30,35,29,.4);
  --shadow-lg: 0 2px 4px rgba(30,35,29,.06), 0 44px 80px -42px rgba(30,35,29,.45);
  --grain-opacity: .45;
}
```

- [ ] **Step 5: Write `packages/web-shared/src/ui/tokens.layout.css`**

Holds typography helpers, button/chip/badge/card CSS, form-field CSS, scrollbar
styling, the `.fade-in` keyframe (transform-only — never opacity), and the
public-nav + dash shell layout used by the member app. Admin shell CSS is added
in U8.

```css
/* packages/web-shared/src/ui/tokens.layout.css */
/* Typography */
.display {
  font-family: var(--font-display);
  font-weight: var(--display-weight);
  letter-spacing: var(--display-tracking);
  line-height: var(--display-lh);
  margin: 0;
}
.eyebrow {
  font-family: var(--font-body);
  font-weight: 600;
  font-size: 11px;
  letter-spacing: var(--eyebrow-tracking);
  text-transform: uppercase;
  color: var(--accent);
  margin: 0;
}
.eyebrow--muted { color: var(--faint); }
.lede { color: var(--muted); font-size: 17px; line-height: 1.55; margin: 0; }
.muted { color: var(--muted); }
.faint { color: var(--faint); }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

/* Buttons / chips / badges / cards / fields — lift verbatim from the
   design reference's styles.css (lines 164–234). Indicators .dot, .rule. */
/* Public nav and dash shell layout — lift from reference (lines 275–332). */
/* Modal / scrim / toast — lift from reference (lines 334–360). */
/* Keyframes: fade-in (transform-only), ping, spin, rowIn, rowOut, modalIn,
   toastIn — lift from reference (lines 270–273, 328–331, 346–348, 358–360). */
/* Scrollbar styling — lift from reference (lines 368–370). */
```

(The "lift from reference" instructions are deterministic — the executor opens
the design reference's `styles.css` and copies the named blocks verbatim. No
interpretation needed.)

- [ ] **Step 6: Write `packages/web-shared/src/ui/theme/readThemeCookie.ts`**

```ts
// packages/web-shared/src/ui/theme/readThemeCookie.ts
import { cookies } from "next/headers";

export type Theme = "atrium" | "noir" | "vellum";
const VALID: ReadonlySet<Theme> = new Set(["atrium", "noir", "vellum"]);

export async function readThemeCookie(
  name: string,
  fallback: Theme,
): Promise<Theme> {
  const store = await cookies();
  const raw = store.get(name)?.value;
  return raw && (VALID as Set<string>).has(raw) ? (raw as Theme) : fallback;
}
```

- [ ] **Step 7: Extend `packages/web-shared/package.json` exports**

Add to the `"exports"` map (do not replace it):
```json
"./ui/tokens.css":       "./src/ui/tokens.css",
"./ui/tokens.theme.noir.css":   "./src/ui/tokens.theme.noir.css",
"./ui/tokens.theme.vellum.css": "./src/ui/tokens.theme.vellum.css",
"./ui/tokens.layout.css":       "./src/ui/tokens.layout.css",
"./ui/theme":            "./src/ui/theme/index.ts"
```

Create `packages/web-shared/src/ui/theme/index.ts`:
```ts
export { readThemeCookie, type Theme } from "./readThemeCookie";
```

- [ ] **Step 8: Replace `apps/member/src/app/globals.css`**

```css
@import "tailwindcss";
@import "@organizer-hub/web-shared/ui/tokens.css";
@import "@organizer-hub/web-shared/ui/tokens.theme.noir.css";
@import "@organizer-hub/web-shared/ui/tokens.theme.vellum.css";
@import "@organizer-hub/web-shared/ui/tokens.layout.css";
```

The Arial body-font rule from `create-next-app` is deleted in this step.

- [ ] **Step 9: Replace `apps/admin/src/app/globals.css`**

Same imports as Step 8. Delete any leftover unbranded styles.

- [ ] **Step 10: Update `apps/member/src/app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Cormorant_Garamond, Hanken_Grotesk, Spectral, Space_Grotesk, Spline_Sans_Mono } from "next/font/google";
import { readThemeCookie } from "@organizer-hub/web-shared/ui/theme";
import "./globals.css";

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["500","600","700"], variable: "--font-cormorant", display: "swap" });
const hanken    = Hanken_Grotesk({    subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-hanken", display: "swap" });
const spectral  = Spectral({          subsets: ["latin"], weight: ["400","500","600"], variable: "--font-spectral", display: "swap" });
const spaceGrot = Space_Grotesk({     subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-space-grotesk", display: "swap" });
const splineMono= Spline_Sans_Mono({  subsets: ["latin"], weight: ["400","500"], variable: "--font-spline-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "OrganizerHub", template: "%s · OrganizerHub" },
  description: "One pane of glass for event organizers — and a membership that opens the door.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await readThemeCookie("oh_member_theme", "atrium");
  const fontVars = [cormorant, hanken, spectral, spaceGrot, splineMono].map((f) => f.variable).join(" ");
  return (
    <html lang="en" data-theme={theme} className={`${fontVars} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
```

- [ ] **Step 11: Update `apps/admin/src/app/layout.tsx`**

Same shape as Step 10, with two differences:
- Metadata title: `{ default: "OrganizerHub Admin", template: "%s · Admin" }`
- Cookie name: `"oh_admin_theme"`
- Default theme: `"noir"`

- [ ] **Step 12: Run typechecks and lint for both apps**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/member lint
pnpm -F @organizer-hub/admin lint
```
Expected: all pass. If `pnpm -F` filter names differ, use the names from
`package.json`.

- [ ] **Step 13: Run both dev servers, confirm shells load and themes render**

```bash
pnpm -F @organizer-hub/member dev   # default port from package.json
# in a second terminal:
pnpm -F @organizer-hub/admin  dev   # different port (per spec, separate physical boundary)
```
Browser checks:
- Member app loads on its port. Title bar reads "OrganizerHub". Page background
  is Atrium ivory `#f1ece1`. No Arial font visible (Inspect `body` →
  `font-family` resolves to Hanken Grotesk).
- Admin app loads on its port. Title bar reads "OrganizerHub Admin". Page
  background is Noir near-black `#100e0b`. Ink text is `#f2ebdd`.

- [ ] **Step 14: Rewrite PRODUCT.md brand sections**

In `PRODUCT.md`, replace the "Brand Personality", "Anti-references", and
"Design Principles" sections with:

```markdown
## Brand Personality

Editorial, considered, premium. The product is a pane of glass over event
organizers and their members — confident enough to take the visual lead,
quiet enough to defer to the evenings on the calendar.

Three coherent themes ship together: **Atrium** (editorial ivory + brass,
the member-app default), **Noir** (cinematic near-black + amber, the admin
control-room default), and **Vellum** (warm paper + deep forest). All three
share the same component vocabulary and interaction patterns — a theme
switch flips tokens, never layouts.

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
4. **Accessible by default.** WCAG AA contrast on every theme combination.
   Visible focus rings on every interactive element. `prefers-reduced-motion`
   respected.
5. **Compose, don't fork.** New variants extend a primitive; three forked
   variants is the signal to refactor, not to add a fourth.
```

- [ ] **Step 15: Commit**

```bash
git add packages/web-shared/src/ui packages/web-shared/package.json \
        apps/member/src/app/globals.css apps/member/src/app/layout.tsx \
        apps/admin/src/app/globals.css  apps/admin/src/app/layout.tsx \
        PRODUCT.md
git commit -m "$(cat <<'EOF'
feat(ui): token system, three themes, branded shells, PRODUCT.md update

- add packages/web-shared/src/ui/tokens.css with @theme inline mapping
  and the Atrium default token set
- add tokens.theme.noir.css and tokens.theme.vellum.css overrides keyed
  on [data-theme]
- add tokens.layout.css with typography helpers, button/chip/badge/card
  CSS, form-field CSS, fade-in keyframe (transform-only), and the
  public-nav + dash shell layout
- add readThemeCookie() server helper and Theme type, exported under
  @organizer-hub/web-shared/ui/theme
- replace apps/member globals.css to import shared tokens; delete the
  Arial leftover from create-next-app
- replace apps/admin globals.css to import shared tokens
- replace apps/member layout.tsx to load Cormorant, Hanken, Spectral,
  Space Grotesk, and Spline Sans Mono via next/font, read theme from
  oh_member_theme cookie (default atrium), set branded metadata
- replace apps/admin layout.tsx with the same font load + branded
  metadata, reading oh_admin_theme cookie (default noir)
- rewrite PRODUCT.md brand personality, anti-references, and design
  principles sections to reflect the new direction
EOF
)"
```

---

## Unit U2: Shared primitives — text, atoms, icons, poster

**Goal:** Ship the primitive React components in `packages/web-shared/src/ui/`
that every screen composes from. Each primitive consumes design tokens through
Tailwind utilities and exposes a typed prop surface.

**Files:**
- Create: `packages/web-shared/src/ui/primitives/Button.tsx`
- Create: `packages/web-shared/src/ui/primitives/Card.tsx`
- Create: `packages/web-shared/src/ui/primitives/Chip.tsx`
- Create: `packages/web-shared/src/ui/primitives/Badge.tsx`
- Create: `packages/web-shared/src/ui/primitives/StatusBadge.tsx`
- Create: `packages/web-shared/src/ui/primitives/Pill.tsx`
- Create: `packages/web-shared/src/ui/primitives/Field.tsx`
- Create: `packages/web-shared/src/ui/primitives/Input.tsx`
- Create: `packages/web-shared/src/ui/primitives/Textarea.tsx`
- Create: `packages/web-shared/src/ui/primitives/Select.tsx`
- Create: `packages/web-shared/src/ui/typography/Display.tsx`
- Create: `packages/web-shared/src/ui/typography/Eyebrow.tsx`
- Create: `packages/web-shared/src/ui/typography/Lede.tsx`
- Create: `packages/web-shared/src/ui/icons/paths.ts`
- Create: `packages/web-shared/src/ui/icons/Icon.tsx`
- Create: `packages/web-shared/src/ui/poster/grain.ts`
- Create: `packages/web-shared/src/ui/poster/moods.ts`
- Create: `packages/web-shared/src/ui/poster/Poster.tsx`
- Create: `packages/web-shared/src/ui/index.ts`
- Modify: `packages/web-shared/package.json` (export `./ui`)
- Test: `packages/web-shared/src/ui/primitives/__tests__/Button.test.tsx`
- Test: `packages/web-shared/src/ui/primitives/__tests__/Chip.test.tsx`
- Test: `packages/web-shared/src/ui/primitives/__tests__/Badge.test.tsx`
- Test: `packages/web-shared/src/ui/primitives/__tests__/Field.test.tsx`
- Test: `packages/web-shared/src/ui/poster/__tests__/moods.test.ts`

- [ ] **Step 1: Confirm test runner availability**

```bash
ls packages/web-shared/vitest.config.* 2>/dev/null || ls packages/web-shared/jest.config.* 2>/dev/null
cat packages/web-shared/package.json | grep -E 'vitest|jest|testing-library'
```

If neither runner is configured, add Vitest + `@testing-library/react` (this
is its own one-step setup before TDD; see Step 2). If a runner exists, use it.

- [ ] **Step 2: (Conditional) Add Vitest if no runner present**

```bash
pnpm -F @organizer-hub/web-shared add -D vitest @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react
```

Create `packages/web-shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
  },
});
```

Create `packages/web-shared/test/setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```

Add to `packages/web-shared/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Write the failing test for Button primary variant**

`packages/web-shared/src/ui/primitives/__tests__/Button.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../Button";

describe("Button", () => {
  it("renders text content", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });
  it("applies primary variant class by default", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn", "btn--primary");
  });
  it("applies the requested variant", () => {
    render(<Button variant="ghost">Cancel</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn", "btn--ghost");
  });
  it("applies block prop", () => {
    render(<Button block>Wide</Button>);
    expect(screen.getByRole("button")).toHaveClass("btn--block");
  });
  it("forwards disabled state", () => {
    render(<Button disabled>Off</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
```

- [ ] **Step 4: Run the failing test**

```bash
pnpm -F @organizer-hub/web-shared test
```
Expected: FAIL — `Cannot find module "../Button"`.

- [ ] **Step 5: Implement Button**

`packages/web-shared/src/ui/primitives/Button.tsx`:
```tsx
import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "solid" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md" | "lg";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  block?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", block = false, className = "", children, ...rest },
  ref,
) {
  const cls = [
    "btn",
    `btn--${variant}`,
    size === "sm" ? "btn--sm" : size === "lg" ? "btn--lg" : "",
    block ? "btn--block" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <button ref={ref} className={cls} {...rest}>
      {children}
    </button>
  );
});
```

- [ ] **Step 6: Run the test, confirm pass**

```bash
pnpm -F @organizer-hub/web-shared test
```
Expected: PASS.

- [ ] **Step 7: Implement Chip with failing test**

`packages/web-shared/src/ui/primitives/__tests__/Chip.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Chip } from "../Chip";

describe("Chip", () => {
  it("renders children", () => {
    render(<Chip>Music</Chip>);
    expect(screen.getByText("Music")).toBeInTheDocument();
  });
  it("applies active state classes when active", () => {
    render(<Chip active>All</Chip>);
    expect(screen.getByText("All")).toHaveClass("chip", "chip--active");
  });
  it("is a button when onClick is provided, a span otherwise", () => {
    const { rerender } = render(<Chip>Static</Chip>);
    expect(screen.getByText("Static").tagName).toBe("SPAN");
    rerender(<Chip onClick={() => {}}>Clickable</Chip>);
    expect(screen.getByText("Clickable").tagName).toBe("BUTTON");
  });
});
```

`packages/web-shared/src/ui/primitives/Chip.tsx`:
```tsx
import type { MouseEventHandler, ReactNode } from "react";

export type ChipProps = {
  children: ReactNode;
  active?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
};

export function Chip({ children, active = false, onClick, className = "" }: ChipProps) {
  const cls = ["chip", active ? "chip--active" : "", className].filter(Boolean).join(" ");
  if (onClick) {
    return <button type="button" className={cls} onClick={onClick}>{children}</button>;
  }
  return <span className={cls}>{children}</span>;
}
```

Add `.chip--active` rule to `tokens.layout.css` (Step 11 below).

- [ ] **Step 8: Implement Badge with failing test**

`__tests__/Badge.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../Badge";

describe("Badge", () => {
  it("applies tone class", () => {
    render(<Badge tone="owner">Owner</Badge>);
    expect(screen.getByText("Owner")).toHaveClass("badge", "badge--owner");
  });
  it("defaults to member tone", () => {
    render(<Badge>Plain</Badge>);
    expect(screen.getByText("Plain")).toHaveClass("badge--member");
  });
});
```

`Badge.tsx`:
```tsx
import type { ReactNode } from "react";
export type BadgeTone = "owner" | "admin" | "member" | "published" | "draft" | "cancelled";
export type BadgeProps = { tone?: BadgeTone; children: ReactNode; className?: string };
export function Badge({ tone = "member", children, className = "" }: BadgeProps) {
  return <span className={["badge", `badge--${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}
```

- [ ] **Step 9: Implement StatusBadge**

`StatusBadge.tsx`:
```tsx
import { Badge } from "./Badge";
const LABEL = { PUBLISHED: "Published", DRAFT: "Draft", CANCELLED: "Cancelled" } as const;
const TONE  = { PUBLISHED: "published", DRAFT: "draft", CANCELLED: "cancelled" } as const;
export type StatusBadgeProps = { status: keyof typeof LABEL };
export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
```

- [ ] **Step 10: Implement Pill, Card, Field, Input, Textarea, Select**

Each is a thin token-consuming wrapper. Files and their interfaces:

`Pill.tsx`:
```tsx
import type { ReactNode } from "react";
export type PillTone = "paid" | "pending" | "refunded" | "active" | "lapsed";
export function Pill({ tone, children, className = "" }: { tone: PillTone; children: ReactNode; className?: string }) {
  return <span className={["pill", `pill--${tone}`, className].filter(Boolean).join(" ")}>{children}</span>;
}
```

`Card.tsx`:
```tsx
import type { HTMLAttributes, ReactNode } from "react";
export type CardProps = HTMLAttributes<HTMLDivElement> & { children: ReactNode; padded?: boolean };
export function Card({ children, padded = false, className = "", ...rest }: CardProps) {
  const cls = ["card", padded ? "card--padded" : "", className].filter(Boolean).join(" ");
  return <div className={cls} {...rest}>{children}</div>;
}
```

`Field.tsx`:
```tsx
import type { ReactNode } from "react";
export function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      {label && <label className="field__label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <p className="muted" style={{ fontSize: 12 }}>{hint}</p>}
    </div>
  );
}
```

`Input.tsx`:
```tsx
import { forwardRef, type InputHTMLAttributes } from "react";
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest }, ref,
) {
  return <input ref={ref} className={["input", className].filter(Boolean).join(" ")} {...rest} />;
});
```

`Textarea.tsx`:
```tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = "", ...rest }, ref,
) {
  return <textarea ref={ref} className={["textarea", className].filter(Boolean).join(" ")} {...rest} />;
});
```

`Select.tsx`:
```tsx
import { forwardRef, type SelectHTMLAttributes } from "react";
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", children, ...rest }, ref,
) {
  return <select ref={ref} className={["select", className].filter(Boolean).join(" ")} {...rest}>{children}</select>;
});
```

Write one focused render test for `Field` (`Field.test.tsx`):
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "../Field";
import { Input } from "../Input";

describe("Field", () => {
  it("associates label with control via htmlFor", () => {
    render(
      <Field label="Email" htmlFor="email">
        <Input id="email" />
      </Field>
    );
    const input = screen.getByLabelText("Email");
    expect(input).toBeInTheDocument();
  });
});
```

- [ ] **Step 11: Extend `tokens.layout.css` with primitive-supporting rules**

Add `.chip--active` (background `var(--accent)`, color `var(--accent-on)`,
border `var(--accent)`) and `.card--padded { padding: 22px 24px; }`. These
back the variant props added in Steps 7 and 10.

- [ ] **Step 12: Implement typography components**

`Display.tsx`:
```tsx
import type { HTMLAttributes, ReactNode } from "react";
export type DisplayProps = HTMLAttributes<HTMLHeadingElement> & {
  as?: "h1" | "h2" | "h3" | "h4";
  size?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
};
const SIZE = { sm: "fontSize:22px", md: "fontSize:30px", lg: "fontSize:38px", xl: "fontSize:48px" } as const;
export function Display({ as: Tag = "h1", size = "md", className = "", style, children, ...rest }: DisplayProps) {
  const cls = ["display", className].filter(Boolean).join(" ");
  const sizeStyle = SIZE[size].split(":");
  return <Tag className={cls} style={{ [sizeStyle[0]]: sizeStyle[1], ...style }} {...rest}>{children}</Tag>;
}
```

`Eyebrow.tsx`:
```tsx
import type { ReactNode } from "react";
export function Eyebrow({ muted = false, children }: { muted?: boolean; children: ReactNode }) {
  return <p className={`eyebrow${muted ? " eyebrow--muted" : ""}`}>{children}</p>;
}
```

`Lede.tsx`:
```tsx
import type { ReactNode } from "react";
export function Lede({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={["lede", className].filter(Boolean).join(" ")}>{children}</p>;
}
```

- [ ] **Step 13: Implement Icon set**

Lift the `paths` object and `Icon` function from the design reference's
`lib.jsx` lines 43–74 verbatim, ported to TypeScript.

`icons/paths.ts` — export a typed `ICON_PATHS: Record<IconName, JSX.Element>`
holding every SVG path group. Names: `calendar`, `pin`, `clock`, `arrowR`,
`arrowL`, `ticket`, `users`, `building`, `plus`, `check`, `x`, `sparkle`,
`bell`, `layers`, `grid`, `logout`, `chevR`, `chevD`, `star`, `crown`,
`inbox`, `settings`, `moon`, `edit`, `eye`.

`icons/Icon.tsx`:
```tsx
import { ICON_PATHS, type IconName } from "./paths";
export type IconProps = { name: IconName; size?: number; className?: string };
export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" style={{ display: "block" }} className={className}>
      {ICON_PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 14: Implement Poster + moods + grain**

`poster/grain.ts`:
```ts
export const GRAIN_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";
```

`poster/moods.ts`:
```ts
export type Mood = "midnight" | "plum" | "forest" | "sand" | "oxblood" | "ember" | "teal";
export const MOODS: Record<Mood, { p1: string; p2: string; ink: string }> = {
  midnight: { p1: "#171d3a", p2: "#39477a", ink: "#c4cdec" },
  plum:     { p1: "#371d3b", p2: "#6c3a64", ink: "#ecccE4" },
  forest:   { p1: "#1a3a2d", p2: "#3f7053", ink: "#cfe5c6" },
  sand:     { p1: "#54401f", p2: "#9c7c3d", ink: "#f3e4ba" },
  oxblood:  { p1: "#42151b", p2: "#7e2c35", ink: "#f1cdc3" },
  ember:    { p1: "#65271c", p2: "#b85a30", ink: "#f6dcae" },
  teal:     { p1: "#103635", p2: "#2f6f6a", ink: "#bfe6e1" },
};
export function monogram(title: string): string {
  const words = title.replace(/[—–-]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|a|an|of|with)$/i.test(w));
  const first = words[0] || title;
  return (first[0] || "").toUpperCase();
}
```

`poster/Poster.tsx`:
```tsx
import type { CSSProperties, ReactNode } from "react";
import { GRAIN_TEXTURE } from "./grain";
import { MOODS, type Mood } from "./moods";

export type PosterProps = {
  mood: Mood;
  label?: string;
  monoSize?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};
export function Poster({ mood, label, monoSize = 200, className = "", style, children }: PosterProps) {
  const m = MOODS[mood];
  const vars: CSSProperties = {
    "--p1": m.p1, "--p2": m.p2, "--p-ink": m.ink, "--grain": GRAIN_TEXTURE,
    ...style,
  } as CSSProperties;
  return (
    <div className={`poster ${className}`} style={vars}>
      <div className="poster__wash" />
      {label != null && (
        <div className="poster__mono" style={{ fontSize: monoSize, padding: "0 0.06em" }}>{label}</div>
      )}
      {children}
    </div>
  );
}
```

Test for `monogram` (`poster/__tests__/moods.test.ts`):
```ts
import { describe, expect, it } from "vitest";
import { monogram } from "../moods";

describe("monogram", () => {
  it("uses the first significant word's initial", () => {
    expect(monogram("An Evening with the Astrid Quartet")).toBe("E");
  });
  it("skips short/stop words", () => {
    expect(monogram("The Cellar Door — A Natural Wine Salon")).toBe("C");
  });
  it("uppercases", () => {
    expect(monogram("midnight garden")).toBe("M");
  });
});
```

The `.poster`, `.poster__wash`, `.poster__mono` CSS rules are part of
`tokens.layout.css` from U1.

- [ ] **Step 15: Write the barrel `src/ui/index.ts`**

```ts
// Primitives
export { Button, type ButtonProps } from "./primitives/Button";
export { Card, type CardProps } from "./primitives/Card";
export { Chip, type ChipProps } from "./primitives/Chip";
export { Badge, type BadgeProps, type BadgeTone } from "./primitives/Badge";
export { StatusBadge, type StatusBadgeProps } from "./primitives/StatusBadge";
export { Pill, type PillTone } from "./primitives/Pill";
export { Field } from "./primitives/Field";
export { Input } from "./primitives/Input";
export { Textarea } from "./primitives/Textarea";
export { Select } from "./primitives/Select";

// Typography
export { Display, type DisplayProps } from "./typography/Display";
export { Eyebrow } from "./typography/Eyebrow";
export { Lede } from "./typography/Lede";

// Icons + Poster
export { Icon, type IconName } from "./icons/Icon";
export { Poster, type Mood } from "./poster/Poster";
export { MOODS, monogram } from "./poster/moods";
export { GRAIN_TEXTURE } from "./poster/grain";

// Theme
export { readThemeCookie, type Theme } from "./theme/readThemeCookie";
```

- [ ] **Step 16: Extend `packages/web-shared/package.json` exports**

```json
"./ui": {
  "types": "./src/ui/index.ts",
  "default": "./src/ui/index.ts"
}
```

(Per existing exports map style — the repo uses source `.ts` paths without a
build step. If web-shared has a build, mirror the existing pattern instead.)

- [ ] **Step 17: Run tests and typecheck**

```bash
pnpm -F @organizer-hub/web-shared test
pnpm -F @organizer-hub/web-shared typecheck
pnpm -F @organizer-hub/member  typecheck
pnpm -F @organizer-hub/admin   typecheck
```
Expected: all pass. Primitives compile against both apps' TypeScript configs.

- [ ] **Step 18: Commit**

```bash
git add packages/web-shared/src/ui packages/web-shared/package.json \
        packages/web-shared/test packages/web-shared/vitest.config.ts
git commit -m "$(cat <<'EOF'
feat(ui): shared UI primitives, typography, icons, poster

- add Button, Card, Chip, Badge, StatusBadge, Pill primitives consuming
  CSS tokens through Tailwind utilities and design-system classes
- add Field, Input, Textarea, Select form atoms with proper label
  association
- add Display, Eyebrow, Lede typography components enforcing the type
  ladder
- add Icon component with 25-glyph 1.6-stroke SVG path catalog
- add Poster component, Mood palette, monogram helper, and SVG film-grain
  texture for the signature duotone event art
- add Vitest + @testing-library/react render-test setup for the primitives
- export everything through packages/web-shared/src/ui/index.ts under the
  @organizer-hub/web-shared/ui subpath
EOF
)"
```

---

## Unit U3: Member public shell + landing page

**Goal:** Replace `apps/member/src/app/page.tsx` (currently a centered-card
sign-in CTA) with the editorial landing page composed from primitives, plus
the public nav and footer used by all public routes.

**Files:**
- Create: `apps/member/src/components/PublicShell.tsx`
- Create: `apps/member/src/components/PublicNav.tsx`
- Create: `apps/member/src/components/PublicFooter.tsx`
- Modify: `apps/member/src/app/page.tsx`
- Create: `packages/web-shared/src/ui/nav/NavLink.tsx`

- [ ] **Step 1: Add `NavLink` to shared package**

```tsx
// packages/web-shared/src/ui/nav/NavLink.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, exact = false, children }: { href: string; exact?: boolean; children: ReactNode }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return <Link href={href} className={`navlink${active ? " navlink--active" : ""}`}>{children}</Link>;
}
```

Export from `src/ui/index.ts`:
```ts
export { NavLink } from "./nav/NavLink";
```

- [ ] **Step 2: Implement PublicNav**

```tsx
// apps/member/src/components/PublicNav.tsx
import Link from "next/link";
import { readSession } from "@organizer-hub/web-shared";
import { Button, NavLink } from "@organizer-hub/web-shared/ui";

export async function PublicNav() {
  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  return (
    <nav className="pubnav">
      <div className="container container--wide pubnav__inner">
        <Link href="/" className="brand">
          <span className="brand__mark">O</span>
          <span className="brand__name">OrganizerHub</span>
        </Link>
        <div className="pubnav__links">
          <NavLink href="/events">Events</NavLink>
          <NavLink href="/membership">Membership</NavLink>
          {session ? (
            <>
              <NavLink href="/dashboard">Dashboard</NavLink>
              <form action="/auth/logout" method="post" style={{ marginLeft: 6 }}>
                <Button variant="ghost" size="sm" type="submit">Sign out</Button>
              </form>
            </>
          ) : (
            <Link href="/auth/login" style={{ marginLeft: 6 }}>
              <Button variant="solid" size="sm">Sign in</Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
```

(`readSession` import path uses the package's existing entry. If the package
exports session helpers through `@organizer-hub/web-shared` root and primitives
through `/ui`, both imports work as shown.)

- [ ] **Step 3: Implement PublicFooter**

```tsx
// apps/member/src/components/PublicFooter.tsx
import Link from "next/link";
export function PublicFooter() {
  return (
    <footer className="container container--wide" style={{ padding: "44px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
      <Link href="/" className="brand">
        <span className="brand__mark">O</span>
        <span className="brand__name">OrganizerHub</span>
      </Link>
      <p className="faint" style={{ fontSize: 13 }}>One pane of glass for event organizers.</p>
    </footer>
  );
}
```

- [ ] **Step 4: Implement PublicShell**

```tsx
// apps/member/src/components/PublicShell.tsx
import type { ReactNode } from "react";
import { PublicNav } from "./PublicNav";
import { PublicFooter } from "./PublicFooter";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="scene">
      {/* @ts-expect-error Async Server Component */}
      <PublicNav />
      {children}
      <PublicFooter />
    </div>
  );
}
```

- [ ] **Step 5: Rewrite the home page**

```tsx
// apps/member/src/app/page.tsx
import Link from "next/link";
import { publicApiFetch } from "@organizer-hub/web-shared/client";
import type { PublicEventView } from "@organizer-hub/web-shared";
import { Button, Card, Display, Eyebrow, Icon, Lede, Poster } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../components/PublicShell";
import { EventCard } from "../components/EventCard"; // shipped in U4 — see note below

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Featured events: first three published events; tolerate fetch errors.
  let featured: PublicEventView[] = [];
  try {
    const page = await publicApiFetch<{ items: PublicEventView[] }>("/public/events?limit=3");
    featured = page.items.slice(0, 3);
  } catch {
    featured = [];
  }

  return (
    <PublicShell>
      <header className="container container--wide" style={{ paddingTop: 64, paddingBottom: 64 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1.05fr .95fr", gap: 48, alignItems: "center" }}>
          <div className="fade-in" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
            <Eyebrow>Members · Events · Evenings of note</Eyebrow>
            <Display as="h1" style={{ fontSize: "clamp(40px, 4.6vw, 58px)", lineHeight: 1.04, margin: "18px 0 20px" }}>
              The evenings worth keeping a seat for.
            </Display>
            <Lede style={{ maxWidth: 460 }}>
              One pane of glass for the societies, clubs, and collectives behind the calendar — and a membership that opens the door to all of them.
            </Lede>
            <div style={{ display: "flex", gap: 12, marginTop: 30 }}>
              <Link href="/events"><Button size="lg">Browse events <Icon name="arrowR" size={16} /></Button></Link>
              <Link href="/membership"><Button size="lg" variant="ghost">Become a member</Button></Link>
            </div>
          </div>
          <Poster mood="oxblood" label="O" monoSize={460}
            className="fade-in"
            style={{ height: 520, borderRadius: "var(--radius-lg)" }}>
            <div style={{ position: "absolute", zIndex: 2, inset: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 30 }}>
              <Display as="h3" style={{ color: "#fff", fontSize: 34 }}>OrganizerHub</Display>
              <p style={{ color: "rgba(255,255,255,.8)", fontSize: 14, marginTop: 6 }}>Membership that opens every door.</p>
            </div>
          </Poster>
        </div>
      </header>

      {featured.length > 0 && (
        <section className="container container--wide" style={{ paddingBottom: 72 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 22 }}>
            <Display as="h2" size="md">On the calendar</Display>
            <Link href="/events" className="link">All events →</Link>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
            {featured.map((ev) => (
              <EventCard key={ev.id} ev={ev} />
            ))}
          </div>
        </section>
      )}
    </PublicShell>
  );
}
```

**Note on `EventCard`:** U3 lands the home page using a *placeholder*
`EventCard` (just a Card with title + link). U4 replaces it with the full
poster card. To keep U3 independently shippable, ship `EventCard` as a stub:

```tsx
// apps/member/src/components/EventCard.tsx — U3 stub
import Link from "next/link";
import { Card } from "@organizer-hub/web-shared/ui";
import type { PublicEventView } from "@organizer-hub/web-shared";
export function EventCard({ ev }: { ev: PublicEventView }) {
  return (
    <Card padded>
      <h3 className="display" style={{ fontSize: 21 }}>{ev.title}</h3>
      <Link href={`/events/${ev.id}`} className="link">View →</Link>
    </Card>
  );
}
```

U4 replaces this file with the full poster-art version.

- [ ] **Step 6: Typecheck**

```bash
pnpm -F @organizer-hub/member typecheck
```
Expected: PASS.

- [ ] **Step 7: Visual verification**

Run `pnpm -F @organizer-hub/member dev`. Visit `/` in a browser. Verify:
- Atrium theme renders (ivory bg, brass accents).
- Hero headline reads in Cormorant Garamond at the clamped size.
- The right column shows a duotone oxblood poster with the "O" monogram and
  the film-grain texture visible at close inspection.
- Below the hero, the featured strip shows up to three event cards (placeholder
  card style — U4 will polish).
- Public nav sticks to top; brand mark + name on left, Events / Membership /
  Sign in (or Dashboard + Sign out) on right.
- Footer shows brand + tagline.
- Focus rings are visible when tabbing through buttons and links.

- [ ] **Step 8: Commit**

```bash
git add apps/member/src/app/page.tsx apps/member/src/components/ \
        packages/web-shared/src/ui/nav packages/web-shared/src/ui/index.ts
git commit -m "$(cat <<'EOF'
feat(member): public shell, branded landing, NavLink primitive

- add PublicNav with brand wordmark, route links, and session-aware
  sign-in/dashboard/sign-out CTAs
- add PublicFooter with brand mark and tagline
- add PublicShell wrapper used by all public routes
- replace apps/member home page with editorial hero, oxblood poster art,
  primary/ghost CTAs, and a featured-3 event-card strip backed by
  publicApiFetch("/public/events")
- add NavLink client component to packages/web-shared/src/ui/nav for
  active-route highlighting
- ship EventCard as a minimal Card stub; full poster-art version lands
  in the events list unit
EOF
)"
```

---

## Unit U4: Member events list + event detail

**Goal:** Repaint `/events` and `/events/[eventId]` with the design language.
Replace the `EventCard` stub from U3 with the full poster card. Convert the
existing label filter into design chip strip.

**Files:**
- Modify: `apps/member/src/components/EventCard.tsx` (replace stub)
- Create: `apps/member/src/components/FilterChips.tsx` (extract from existing
  page-level inline component)
- Create: `apps/member/src/components/Fact.tsx` (icon + label + value block)
- Modify: `apps/member/src/app/events/page.tsx`
- Modify: `apps/member/src/app/events/[eventId]/page.tsx`
- Modify: `apps/member/src/app/events/[eventId]/TicketRow.tsx`

- [ ] **Step 1: Replace `EventCard` stub with poster card**

```tsx
// apps/member/src/components/EventCard.tsx
import Link from "next/link";
import { Card, Chip, Display, Eyebrow, Icon, Poster, monogram, type Mood } from "@organizer-hub/web-shared/ui";
import type { PublicEventView } from "@organizer-hub/web-shared";

const MOOD_BY_INDEX: Mood[] = ["midnight", "plum", "forest", "sand", "oxblood", "ember", "teal"];
function moodFor(ev: PublicEventView): Mood {
  // Deterministic moodpick from id hash so the same event keeps the same poster.
  let h = 0;
  for (let i = 0; i < ev.id.length; i++) h = (h * 31 + ev.id.charCodeAt(i)) | 0;
  return MOOD_BY_INDEX[Math.abs(h) % MOOD_BY_INDEX.length];
}
function lowestPriceCents(ev: PublicEventView): number {
  return ev.ticketTypes?.reduce((m, t) => Math.min(m, t.priceCents), Infinity) ?? Infinity;
}
function money(cents: number): string {
  if (cents === 0) return "Free";
  const v = cents / 100;
  return "$" + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
}
function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function EventCard({ ev, tall = false }: { ev: PublicEventView; tall?: boolean }) {
  const lo = lowestPriceCents(ev);
  const priceText = lo === Infinity ? "Tickets" : lo === 0 ? "From free" : `From ${money(lo)}`;
  return (
    <Link href={`/events/${ev.id}`}>
      <Card padded={false} className="card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Poster mood={moodFor(ev)} label={monogram(ev.title)} monoSize={tall ? 220 : 150}
          style={{ height: tall ? 260 : 188 }}>
          {ev.label && (
            <div style={{ position: "absolute", zIndex: 2, top: 14, left: 14, right: 14 }}>
              <Chip>{ev.label.name}</Chip>
            </div>
          )}
        </Poster>
        <div style={{ padding: "16px 18px 18px", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
          {ev.organization && <Eyebrow muted>{ev.organization.name}</Eyebrow>}
          <Display as="h3" style={{ fontSize: tall ? 26 : 21 }}>{ev.title}</Display>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 13.5, marginTop: "auto" }}>
            <Icon name="calendar" size={15} />
            <span>{fmtShortDate(ev.startsAt)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{priceText}</span>
            <span style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600 }}>
              View <Icon name="arrowR" size={14} />
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
}
```

Adjust the `PublicEventView` field names to match what the existing API
returns (`organization`, `label`, `ticketTypes`, `startsAt`). If a field
doesn't exist, omit gracefully.

- [ ] **Step 2: Implement FilterChips**

```tsx
// apps/member/src/components/FilterChips.tsx
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Chip } from "@organizer-hub/web-shared/ui";

export function FilterChips({ labels }: { labels: { id: string; name: string }[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("labelId");
  function pick(id: string | null) {
    const next = new URLSearchParams(params.toString());
    if (id) next.set("labelId", id); else next.delete("labelId");
    router.push(`/events?${next.toString()}`);
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 30 }}>
      <Chip active={!active} onClick={() => pick(null)}>All</Chip>
      {labels.map((l) => (
        <Chip key={l.id} active={active === l.id} onClick={() => pick(l.id)}>{l.name}</Chip>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/member/src/app/events/page.tsx`**

```tsx
import { publicApiFetch } from "@organizer-hub/web-shared/client";
import type { PublicEventView } from "@organizer-hub/web-shared";
import { Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";
import { EventCard } from "../../components/EventCard";
import { FilterChips } from "../../components/FilterChips";

export const dynamic = "force-dynamic";

type SP = { labelId?: string; cursor?: string };

export default async function EventsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.labelId) qs.set("labelId", sp.labelId);
  if (sp.cursor) qs.set("cursor", sp.cursor);
  const page = await publicApiFetch<{ items: PublicEventView[]; nextCursor?: string; labels?: { id: string; name: string }[] }>(`/public/events?${qs.toString()}`);

  return (
    <PublicShell>
      <div className="container container--wide" style={{ paddingTop: 48, paddingBottom: 72 }}>
        <Eyebrow>The calendar</Eyebrow>
        <Display as="h1" size="lg" style={{ margin: "12px 0 24px" }}>Upcoming events</Display>
        {page.labels && page.labels.length > 0 && <FilterChips labels={page.labels} />}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 22 }}>
          {page.items.map((ev) => <EventCard key={ev.id} ev={ev} />)}
        </div>
        {page.nextCursor && (
          <div style={{ marginTop: 32 }}>
            <a href={`/events?cursor=${page.nextCursor}${sp.labelId ? `&labelId=${sp.labelId}` : ""}`} className="link">Next page →</a>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
```

- [ ] **Step 4: Implement Fact (used in event detail)**

```tsx
// apps/member/src/components/Fact.tsx
import type { ReactNode } from "react";
import { Eyebrow, Icon, type IconName } from "@organizer-hub/web-shared/ui";

export function Fact({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--faint)", marginBottom: 7 }}>
        <Icon name={icon} size={15} />
        <Eyebrow muted>{label}</Eyebrow>
      </div>
      <div style={{ fontSize: 15.5, fontWeight: 500 }}>{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Rewrite `apps/member/src/app/events/[eventId]/page.tsx`**

Compose hero poster (height 380) + sticky-overhang Card (margin-top -120):
```tsx
import { publicApiFetch, apiFetch, UnauthorizedError } from "@organizer-hub/web-shared/client";
import type { PublicEventView, TicketCoverage } from "@organizer-hub/web-shared";
import { Card, Chip, Display, Eyebrow, Icon, Poster, monogram } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../../components/PublicShell";
import { Fact } from "../../../components/Fact";
import { TicketRow } from "./TicketRow";
import { moodFor } from "../../../components/EventCard"; // export moodFor from EventCard

export const dynamic = "force-dynamic";

export default async function EventDetailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const ev = await publicApiFetch<PublicEventView>(`/public/events/${eventId}`);
  let coverage: TicketCoverage[] = [];
  try {
    coverage = await apiFetch<TicketCoverage[]>(`/events/${eventId}/coverage`);
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }
  return (
    <PublicShell>
      <Poster mood={moodFor(ev)} label={monogram(ev.title)} monoSize={520} style={{ height: 380 }}>
        <div style={{ position: "absolute", zIndex: 2, inset: 0, background: "linear-gradient(180deg, transparent 40%, rgba(0,0,0,.5))" }} />
      </Poster>
      <div className="container container--narrow" style={{ marginTop: -120, position: "relative", zIndex: 3, paddingBottom: 80 }}>
        <Card style={{ padding: "34px 38px", boxShadow: "var(--shadow-lg)" }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
            {ev.label && <Chip>{ev.label.name}</Chip>}
            {ev.organization && <Eyebrow muted>{ev.organization.name}</Eyebrow>}
          </div>
          <Display as="h1" style={{ fontSize: 44, marginBottom: 22 }}>{ev.title}</Display>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, paddingBottom: 26, borderBottom: "1px solid var(--line)" }}>
            <Fact icon="calendar" label="Date">{new Date(ev.startsAt).toLocaleDateString()}</Fact>
            <Fact icon="clock" label="Time">{new Date(ev.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Fact>
            <Fact icon="pin" label="Venue">{ev.venue ?? "TBA"}</Fact>
          </div>
          {ev.description && (
            <div style={{ padding: "26px 0", borderBottom: "1px solid var(--line)" }}>
              <Eyebrow muted>About</Eyebrow>
              <p style={{ fontSize: 16, lineHeight: 1.65, marginTop: 10 }}>{ev.description}</p>
            </div>
          )}
          <div style={{ paddingTop: 24 }}>
            <Eyebrow muted>Tickets</Eyebrow>
            <Card style={{ marginTop: 12, overflow: "hidden" }}>
              {ev.ticketTypes.map((tt) => (
                <TicketRow key={tt.id} ticket={tt} coverage={coverage.find((c) => c.ticketTypeId === tt.id)} eventId={ev.id} />
              ))}
            </Card>
          </div>
        </Card>
      </div>
    </PublicShell>
  );
}
```

Export `moodFor` from `EventCard.tsx` so the detail page reuses the same
deterministic mood selection:
```tsx
export { moodFor }; // add to EventCard.tsx exports
```

- [ ] **Step 6: Update `TicketRow.tsx` to use primitives**

Open the existing client component, replace the inline-Tailwind buttons and
labels with `<Button variant="primary"|"ghost">` and `<Chip>` + `<Badge>`.
Keep all existing behavior intact (the `useActionState` calls for
`claimFreeTicket`, `requestSpot` Server Actions). Only the JSX shells change.

- [ ] **Step 7: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member dev
```
- Visit `/events`. Filter chips render along the top (or skip if no labels).
- Three-up event card grid renders with poster art (deterministic mood per
  event), event title in display font, date + price line.
- Click a card. Detail page shows large hero poster, sticky-overhang Card
  with facts grid, description, ticket list. Buy/Claim/Request buttons
  match primitive variants.

- [ ] **Step 8: Commit**

```bash
git add apps/member/src/components/EventCard.tsx \
        apps/member/src/components/FilterChips.tsx \
        apps/member/src/components/Fact.tsx \
        apps/member/src/app/events/page.tsx \
        apps/member/src/app/events/[eventId]/page.tsx \
        apps/member/src/app/events/[eventId]/TicketRow.tsx
git commit -m "$(cat <<'EOF'
feat(member): events list + event detail redesign

- replace EventCard stub with full poster-art card composing Poster,
  Chip, Display, Eyebrow, Icon; deterministic mood per event id
- extract FilterChips client component for URL-bound label filtering
- repaint /events page with eyebrow + display title + filter chips +
  3-up card grid; cursor pagination preserved
- repaint /events/[eventId] page with hero poster, sticky-overhang
  Card, fact grid (date/time/venue), description, and ticket list
- migrate TicketRow shells to Button + Chip + Badge primitives without
  changing the underlying Server Action behavior
- add Fact component for icon + label + value blocks
EOF
)"
```

---

## Unit U5: Member membership pricing + branded sign-in landing

**Goal:** Repaint `/membership` as the 3-tier pricing grid; add a branded
sign-in landing at `/auth/login` that posts through to the existing OIDC
kick-off (moved to `/auth/login/authorize`).

**Files:**
- Modify: `apps/member/src/app/membership/page.tsx`
- Create: `apps/member/src/app/auth/login/page.tsx`
- Move: `apps/member/src/app/auth/login/route.ts` → `apps/member/src/app/auth/login/authorize/route.ts`
- Modify: `apps/member/src/app/membership/actions.ts` (if redirect target on
  unauthenticated changes — confirm path)

- [ ] **Step 1: Move the OIDC route handler**

```bash
mkdir -p apps/member/src/app/auth/login/authorize
git mv apps/member/src/app/auth/login/route.ts apps/member/src/app/auth/login/authorize/route.ts
```

Update any redirect targets in `subscribeToTier`, `buyTicket`, etc. that
currently send unauthenticated users to `/auth/login` — they continue to
work because the new `/auth/login` is the landing page that contains a
"Sign in" form posting to `/auth/login/authorize`.

- [ ] **Step 2: Implement the branded sign-in page**

```tsx
// apps/member/src/app/auth/login/page.tsx
import { Button, Display, Eyebrow, Field, Icon, Input, Lede, Poster } from "@organizer-hub/web-shared/ui";

export default function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  return (
    <div className="scene" style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      <Poster mood="midnight" label="O" monoSize={420} style={{ height: "100vh" }}>
        <div style={{ position: "absolute", zIndex: 2, inset: 0, padding: 48, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div className="brand">
            <span className="brand__mark">O</span>
            <span className="brand__name" style={{ color: "#fff" }}>OrganizerHub</span>
          </div>
          <div>
            <Display as="h2" style={{ color: "#fff", fontSize: 38, maxWidth: 360 }}>
              One pane of glass for event organizers.
            </Display>
            <Lede style={{ color: "rgba(255,255,255,.75)", marginTop: 14, maxWidth: 340 }}>
              Sign in to manage your societies, claim your seats, and track your evenings.
            </Lede>
          </div>
        </div>
      </Poster>
      <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
        <div style={{ width: "100%", maxWidth: 380 }}>
          <Eyebrow>Welcome back</Eyebrow>
          <Display as="h1" size="md" style={{ margin: "12px 0 6px" }}>Sign in</Display>
          <p className="muted" style={{ fontSize: 14, marginBottom: 28 }}>You'll be sent to the authentication provider.</p>
          <form action="/auth/login/authorize" method="get" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <input type="hidden" name="next" value="" />
            <Button size="lg" type="submit" block>Continue <Icon name="arrowR" size={16} /></Button>
          </form>
        </div>
      </div>
    </div>
  );
}
```

(The form GETs `/auth/login/authorize`, which is the moved route handler
that issues the PKCE redirect to the IdP. `next` is a hidden field; if the
existing route handler reads a `next` query param to restore the post-login
target, populate it here from `searchParams`.)

- [ ] **Step 3: Repaint membership page**

```tsx
// apps/member/src/app/membership/page.tsx
import { publicApiFetch } from "@organizer-hub/web-shared/client";
import { Badge, Button, Card, Display, Eyebrow, Icon, Lede } from "@organizer-hub/web-shared/ui";
import { PublicShell } from "../../components/PublicShell";
import { subscribeToTier } from "./actions";

type Plan = { lookupKey: string; tier: "BRONZE"|"SILVER"|"GOLD"; name: string; tagline: string; priceCents: number; cadence: "month"|"year"; perks: string[]; featured?: boolean };

export const dynamic = "force-dynamic";

function money(cents: number): string {
  if (cents === 0) return "Free";
  const v = cents / 100;
  return "$" + (v % 1 === 0 ? v.toFixed(0) : v.toFixed(2));
}

export default async function MembershipPage() {
  const plans = await publicApiFetch<Plan[]>("/public/memberships");
  return (
    <PublicShell>
      <div className="container" style={{ paddingTop: 56, paddingBottom: 80, textAlign: "center" }}>
        <Eyebrow>One membership, every society</Eyebrow>
        <Display as="h1" size="xl" style={{ margin: "14px 0 14px" }}>Become a member</Display>
        <Lede style={{ maxWidth: 520, margin: "0 auto" }}>
          Pick a tier. Each tier covers everything in the tiers beneath it — claim covered seats free, across every organizer on the platform.
        </Lede>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 22, marginTop: 44, textAlign: "left" }}>
          {plans.map((pl) => (
            <Card key={pl.lookupKey} style={{
              padding: "30px 28px",
              position: "relative",
              borderColor: pl.featured ? "var(--accent)" : "var(--line)",
              borderWidth: pl.featured ? 2 : 1,
              boxShadow: pl.featured ? "var(--shadow)" : "none",
            }}>
              {pl.featured && <Badge tone="admin" className="absolute" >Most chosen</Badge>}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Icon name="crown" size={22} />
                <Display as="h2" size="md">{pl.name}</Display>
              </div>
              <p className="muted" style={{ fontSize: 14, marginTop: 8 }}>{pl.tagline}</p>
              <div style={{ margin: "18px 0", display: "flex", alignItems: "baseline", gap: 4 }}>
                <span className="display" style={{ fontSize: 42 }}>{money(pl.priceCents)}</span>
                <span className="muted">/{pl.cadence}</span>
              </div>
              <hr className="rule" />
              <ul style={{ listStyle: "none", padding: 0, margin: "18px 0 24px", display: "flex", flexDirection: "column", gap: 11 }}>
                {pl.perks.map((perk) => (
                  <li key={perk} style={{ display: "flex", gap: 10, fontSize: 14 }}>
                    <Icon name="check" size={16} />
                    <span>{perk}</span>
                  </li>
                ))}
              </ul>
              <form action={subscribeToTier}>
                <input type="hidden" name="lookupKey" value={pl.lookupKey} />
                <Button block size="md" variant={pl.featured ? "primary" : "solid"} type="submit">
                  Subscribe · {money(pl.priceCents)}/{pl.cadence}
                </Button>
              </form>
            </Card>
          ))}
        </div>
      </div>
    </PublicShell>
  );
}
```

- [ ] **Step 4: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member dev
```
- `/membership` shows 3-tier grid with crown icons, perks lists, featured
  tier emphasized. Subscribe button kicks the existing Server Action which
  still redirects to Stripe Checkout.
- `/auth/login` shows split layout: midnight poster on left, branded sign-in
  form on right. Continue button GETs `/auth/login/authorize`, which is the
  moved OIDC route handler — clicking Continue redirects to the IdP.

- [ ] **Step 5: Commit**

```bash
git add apps/member/src/app/membership/page.tsx \
        apps/member/src/app/auth/login/page.tsx \
        apps/member/src/app/auth/login/authorize/route.ts
git commit -m "$(cat <<'EOF'
feat(member): branded sign-in landing + membership pricing redesign

- repaint /membership with 3-tier card grid using shared primitives;
  featured tier highlighted with brass border and shadow; subscribe
  forms continue to post through the existing Server Action
- add /auth/login page as a branded split-screen landing (midnight
  poster + sign-in form); Continue button submits to the moved
  route handler at /auth/login/authorize
- move existing OIDC PKCE route handler from /auth/login/route.ts
  to /auth/login/authorize/route.ts so the landing page can own /auth/login
EOF
)"
```

---

## Unit U6: Member dashboard shell + overview

**Goal:** Replace the horizontal-top-bar dashboard with the 248px sidebar
shell. Repaint the dashboard overview with stat cards composed from
primitives.

**Files:**
- Create: `apps/member/src/components/DashShell.tsx`
- Create: `apps/member/src/components/DashSidebar.tsx`
- Create: `packages/web-shared/src/ui/nav/NavItem.tsx`
- Create: `apps/member/src/components/StatCard.tsx`
- Modify: `apps/member/src/app/dashboard/layout.tsx`
- Modify: `apps/member/src/app/dashboard/page.tsx`
- Delete: `apps/member/src/app/dashboard/NavLinks.tsx` (functionality moves
  into DashSidebar)

- [ ] **Step 1: Add NavItem to shared package**

```tsx
// packages/web-shared/src/ui/nav/NavItem.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon";

export function NavItem({
  href, icon, children, badge, exact = false,
}: { href: string; icon: IconName; children: ReactNode; badge?: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} className={`navitem${active ? " navitem--active" : ""}`}>
      <span className="navitem__icon"><Icon name={icon} size={17} /></span>
      <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{children}</span>
      {badge}
    </Link>
  );
}
```

Export from `index.ts`.

- [ ] **Step 2: Implement DashSidebar**

```tsx
// apps/member/src/components/DashSidebar.tsx
import Link from "next/link";
import { NavItem } from "@organizer-hub/web-shared/ui";
import type { Session } from "@organizer-hub/web-shared";

export function DashSidebar({ session }: { session: Session }) {
  return (
    <aside className="dash__side">
      <Link href="/" className="brand" style={{ marginBottom: 22, paddingLeft: 6 }}>
        <span className="brand__mark">O</span>
        <span className="brand__name" style={{ fontSize: 17 }}>OrganizerHub</span>
      </Link>
      <NavItem href="/dashboard" icon="grid" exact>Overview</NavItem>
      <NavItem href="/dashboard/membership" icon="crown">My membership</NavItem>
      <NavItem href="/dashboard/requests" icon="ticket">My requests</NavItem>
      <NavItem href="/dashboard/payments" icon="layers">Payments</NavItem>
      <div style={{ marginTop: "auto", paddingTop: 16, borderTop: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 6px" }}>
          <div style={{ width: 34, height: 34, borderRadius: 999, background: "var(--accent)", color: "var(--accent-on)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 14 }}>
            {(session.name ?? session.email ?? "").split(" ").map((w) => w[0]).join("")}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.name ?? session.email}</div>
            <div className="faint" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{session.email}</div>
          </div>
          <form action="/auth/logout" method="post">
            <button type="submit" className="navitem__icon" style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }} aria-label="Sign out">
              <span style={{ color: "var(--faint)" }}>↩</span>
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Implement DashShell**

```tsx
// apps/member/src/components/DashShell.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@organizer-hub/web-shared";
import { DashSidebar } from "./DashSidebar";

export async function DashShell({ children }: { children: ReactNode }) {
  const session = await readSession({
    session: "oh_member_session",
    refresh: "oh_member_refresh",
    accessToken: "oh_member_access_token",
  });
  if (!session) redirect("/auth/login");
  return (
    <div className="dash">
      <DashSidebar session={session} />
      <main className="dash__main fade-in">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Replace `apps/member/src/app/dashboard/layout.tsx`**

```tsx
import type { ReactNode } from "react";
import { DashShell } from "../../components/DashShell";
export default function DashboardLayout({ children }: { children: ReactNode }) {
  // @ts-expect-error Async Server Component
  return <DashShell>{children}</DashShell>;
}
```

Delete `apps/member/src/app/dashboard/NavLinks.tsx`.

- [ ] **Step 5: Implement StatCard**

```tsx
// apps/member/src/components/StatCard.tsx
import { Card, Icon, type IconName } from "@organizer-hub/web-shared/ui";
export function StatCard({ num, label, icon, accent = false }: { num: string | number; label: string; icon: IconName; accent?: boolean }) {
  return (
    <Card style={{ padding: "20px 22px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className="stat__num" style={{ color: accent ? "var(--accent)" : "var(--ink)" }}>{num}</div>
        <span style={{ color: accent ? "var(--accent)" : "var(--faint)" }}><Icon name={icon} size={20} /></span>
      </div>
      <div className="stat__label">{label}</div>
    </Card>
  );
}
```

Add `.stat__num` and `.stat__label` to `tokens.layout.css` if not present
(lifted from reference lines 351–352).

- [ ] **Step 6: Repaint `apps/member/src/app/dashboard/page.tsx`**

Replace the current `<Card>`-grid implementation with the new shell composition:
```tsx
import { apiFetch } from "@organizer-hub/web-shared/client";
import type { MembershipView, RequesterTicketRequestView } from "@organizer-hub/web-shared";
import { Display, Eyebrow } from "@organizer-hub/web-shared/ui";
import { StatCard } from "../../components/StatCard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [membership, requests] = await Promise.all([
    apiFetch<MembershipView | null>("/memberships/me").catch(() => null),
    apiFetch<RequesterTicketRequestView[]>("/requests").catch(() => []),
  ]);
  const pending = requests.filter((r) => r.status === "PENDING").length;
  return (
    <>
      <Eyebrow>Welcome back</Eyebrow>
      <Display as="h1" size="lg" style={{ margin: "10px 0 28px" }}>Overview</Display>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 36 }}>
        <StatCard num={membership ? membership.tier ?? "—" : "None"} label="Membership" icon="crown" accent />
        <StatCard num={requests.length} label="Total requests" icon="ticket" />
        <StatCard num={pending} label="Pending" icon="inbox" accent={pending > 0} />
        <StatCard num={(requests.length - pending)} label="Resolved" icon="check" />
      </div>
    </>
  );
}
```

- [ ] **Step 7: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member dev
```
Visit `/dashboard`. Sidebar appears on left with 4 NavItems. Active route is
highlighted. Hover states work. User card at sidebar bottom shows initials.
The stats grid renders with display-font numbers.

- [ ] **Step 8: Commit**

```bash
git add apps/member/src/components/DashShell.tsx \
        apps/member/src/components/DashSidebar.tsx \
        apps/member/src/components/StatCard.tsx \
        apps/member/src/app/dashboard/layout.tsx \
        apps/member/src/app/dashboard/page.tsx \
        packages/web-shared/src/ui/nav/NavItem.tsx \
        packages/web-shared/src/ui/index.ts
git rm apps/member/src/app/dashboard/NavLinks.tsx
git commit -m "$(cat <<'EOF'
feat(member): dashboard sidebar shell + redesigned overview

- add DashShell that gates on session and renders the 248px sidebar
  + main content grid; layout.tsx delegates to it
- add DashSidebar with brand, four NavItems (Overview / Membership /
  Requests / Payments), and a user card with sign-out at the bottom
- add NavItem client component to the shared package for active-route
  highlighting in sidebar nav
- add StatCard composition consuming Card + Icon primitives
- replace dashboard overview page with stats grid backed by existing
  membership and requests API calls
- delete the old top-bar NavLinks client component
EOF
)"
```

---

## Unit U7: Member dashboard subpages + theme switcher

**Goal:** Repaint `/dashboard/membership`, `/dashboard/requests`,
`/dashboard/payments`. Add the theme switcher to the dashboard sidebar
(persists choice via cookie).

**Files:**
- Modify: `apps/member/src/app/dashboard/membership/page.tsx`
- Modify: `apps/member/src/app/dashboard/requests/page.tsx`
- Modify: `apps/member/src/app/dashboard/payments/page.tsx`
- Create: `packages/web-shared/src/ui/theme/ThemeSwitcher.tsx`
- Create: `packages/web-shared/src/ui/theme/setThemeCookie.ts`
- Create: `packages/web-shared/src/ui/overlays/Toast.tsx`
- Modify: `apps/member/src/components/DashSidebar.tsx` (add theme switcher)

- [ ] **Step 1: Add Toast + useToast to shared package**

```tsx
// packages/web-shared/src/ui/overlays/Toast.tsx
"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type ToastContextValue = { toast: (msg: string) => void };
const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export function useToast(): ToastContextValue {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("useToast must be inside <ToastProvider>");
  return v;
}
```

Mount `<ToastProvider>` in member `RootLayout` body (around `{children}`).

- [ ] **Step 2: Add setThemeCookie Server Action**

```ts
// packages/web-shared/src/ui/theme/setThemeCookie.ts
"use server";
import { cookies } from "next/headers";
import type { Theme } from "./readThemeCookie";

export async function setThemeCookie(name: string, theme: Theme): Promise<void> {
  const store = await cookies();
  store.set(name, theme, { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 });
}
```

- [ ] **Step 3: Add ThemeSwitcher client component**

```tsx
// packages/web-shared/src/ui/theme/ThemeSwitcher.tsx
"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import type { Theme } from "./readThemeCookie";
import { setThemeCookie } from "./setThemeCookie";

const THEMES: { value: Theme; label: string }[] = [
  { value: "atrium", label: "Atrium" },
  { value: "noir", label: "Noir" },
  { value: "vellum", label: "Vellum" },
];

export function ThemeSwitcher({ cookieName, current }: { cookieName: string; current: Theme }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  function pick(t: Theme) {
    document.documentElement.setAttribute("data-theme", t);
    start(async () => {
      await setThemeCookie(cookieName, t);
      router.refresh();
    });
  }
  return (
    <div role="radiogroup" aria-label="Theme" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {THEMES.map((t) => (
        <button
          key={t.value}
          role="radio"
          aria-checked={current === t.value}
          disabled={pending}
          onClick={() => pick(t.value)}
          className={`navitem${current === t.value ? " navitem--active" : ""}`}
        >
          <span style={{ flex: 1 }}>{t.label}</span>
          {current === t.value && <span>•</span>}
        </button>
      ))}
    </div>
  );
}
```

Export from `index.ts`.

- [ ] **Step 4: Wire ThemeSwitcher into DashSidebar**

Modify `DashSidebar` to accept `currentTheme: Theme` and render the switcher
above the user card. Pass `currentTheme` from `DashShell` (which already reads
the cookie via `readThemeCookie`).

- [ ] **Step 5: Repaint `/dashboard/membership`**

Compose: poster header band + key/value list + change/cancel actions, all
through primitives. Keep the existing `<CancelButton>` client component but
restyle its `<button>` as `<Button variant="danger">`.

- [ ] **Step 6: Repaint `/dashboard/requests`**

Replace the existing `<RequestList>` + `<RequestStatusBadge>` with primitives:
each request row is a flex row with `<Badge>` or `<Pill>` for status, hover
on the row, optional action buttons (cancel pending request).

- [ ] **Step 7: Repaint `/dashboard/payments`**

Use the `<DataTable>` primitive — wait, that's not built until U10. For this
unit, ship payments with an inline table that previews the structure
(`<table className="tbl">` + `<thead>` + tbody rows). U10 will refactor to
`<DataTable>`.

- [ ] **Step 8: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member dev
```
Visit each dashboard subpage. Theme switcher in sidebar flips
`<html data-theme>` and persists in cookie (refresh confirms).

- [ ] **Step 9: Commit**

```bash
git add apps/member/src/app/dashboard \
        packages/web-shared/src/ui/theme \
        packages/web-shared/src/ui/overlays \
        packages/web-shared/src/ui/index.ts \
        apps/member/src/components/DashSidebar.tsx
git commit -m "$(cat <<'EOF'
feat(member): dashboard subpages redesign + theme switcher

- add ToastProvider + useToast hook to the shared package; mount the
  provider in the member root layout
- add setThemeCookie Server Action and ThemeSwitcher client component
  that updates [data-theme] synchronously and persists choice via cookie
- add the ThemeSwitcher to the dashboard sidebar above the user card
- repaint /dashboard/membership with poster header band, key/value
  list, and primitive-backed action buttons
- repaint /dashboard/requests with primitive rows and Pill status
  indicators
- repaint /dashboard/payments with a token-styled table; DataTable
  primitive arrives in a later unit and will replace the inline markup
EOF
)"
```

---

## Unit U8: Admin shell — brand corner, topbar, sidebar, layout

**Goal:** Build the admin app's grid shell (256px sidebar + 64px topbar).
Wire navigation, user menu, notification panel (empty for now), org
switcher placeholder, and the theme switcher. Admin defaults to Noir.

**Files:**
- Append to: `packages/web-shared/src/ui/tokens.layout.css` (admin shell CSS
  block from reference `admin.css`)
- Extend: `packages/web-shared/src/ui/icons/paths.ts` (admin icons: `search`,
  `refresh`, `dollar`, `card`, `pie`, `mail`, `filter`, `dots`, `trendUp`,
  `trendDown`, `home`, `arrowUpRight`, `cal2`, `tag`, `download`)
- Create: `packages/web-shared/src/ui/overlays/DropdownMenu.tsx`
- Create: `apps/admin/src/components/AdminShell.tsx`
- Create: `apps/admin/src/components/BrandCorner.tsx`
- Create: `apps/admin/src/components/TopBar.tsx`
- Create: `apps/admin/src/components/Sidebar.tsx`
- Create: `apps/admin/src/components/PageHead.tsx`
- Create: `apps/admin/src/components/AdminNav.ts` (nav config)
- Modify: `apps/admin/src/app/layout.tsx` (wrap children in `AdminShell`)
- Modify or create: `apps/admin/src/app/page.tsx` (stub Dashboard route)

- [ ] **Step 1: Append admin shell CSS to `tokens.layout.css`**

Lift the design reference's `admin.css` lines 1–237 verbatim into the bottom
of `packages/web-shared/src/ui/tokens.layout.css`. Includes `.ad`,
`.ad__brand`, `.ad__top`, `.ad__search`, `.ad__iconbtn`, `.ad__user`,
`.ad__menu`, `.ad__notifs`, `.ad__notif`, `.ad__side`, `.ad__group`,
`.ad__org`, `.ad__main`, `.ad__head`, `.ad__crumb`, `.kpi`, `.panel`,
`.grid-*` responsive helpers, `.tbl`, `.tbl-wrap`, `.cellface`, `.cellthumb`,
`.toolbar`, `.segmented`, `.bars`, `.bars__col`, `.bars__bar`, `.bars__lbl`,
`.legend`, `.progress`, `.pill`, `.feed`, and the `@media (max-width:1100px)`
sidebar collapse rule.

- [ ] **Step 2: Extend `icons/paths.ts` with admin glyphs**

Add the new path entries — lift each from the reference's `admin.css` icon
usage. Names: `search`, `refresh`, `dollar`, `card`, `pie`, `mail`, `filter`,
`dots`, `trendUp`, `trendDown`, `home`, `arrowUpRight`, `cal2`, `tag`,
`download`. Each is a `<g>` element with one or more `<path>` children using
the same 1.6 stroke as the existing set.

- [ ] **Step 3: Implement DropdownMenu primitive**

```tsx
// packages/web-shared/src/ui/overlays/DropdownMenu.tsx
"use client";
import { useEffect, useRef, type ReactNode } from "react";

export function DropdownMenu({ open, onClose, anchor, children }: {
  open: boolean;
  onClose: () => void;
  anchor: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 50 }} />
      <div ref={ref} className="ad__menu" style={{ [anchor]: 18 } as React.CSSProperties}>
        {children}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Admin nav config**

```ts
// apps/admin/src/components/AdminNav.ts
import type { IconName } from "@organizer-hub/web-shared/ui";
export type AdminNavItem = { id: string; href: string; icon: IconName; label: string; live?: boolean };
export type AdminNavGroup = { group: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  { group: "Overview", items: [
    { id: "dashboard", href: "/", icon: "grid", label: "Dashboard" },
    { id: "analytics", href: "/analytics", icon: "pie", label: "Analytics" },
  ]},
  { group: "Manage", items: [
    { id: "events", href: "/events", icon: "cal2", label: "Events" },
    { id: "waitlist", href: "/waitlist", icon: "inbox", label: "Waitlist", live: true },
    { id: "orders", href: "/transactions", icon: "card", label: "Orders" },
  ]},
  { group: "People", items: [
    { id: "members", href: "/members", icon: "users", label: "Members" },
  ]},
];
```

- [ ] **Step 5: BrandCorner**

```tsx
// apps/admin/src/components/BrandCorner.tsx
import Link from "next/link";
export function BrandCorner() {
  return (
    <div className="ad__brand">
      <Link href="/" className="brand">
        <span className="brand__mark">O</span>
        <span className="brand__name">OrganizerHub</span>
      </Link>
      <span className="ad__brand-tag">Admin</span>
    </div>
  );
}
```

- [ ] **Step 6: TopBar**

```tsx
// apps/admin/src/components/TopBar.tsx
"use client";
import { useState } from "react";
import { Icon } from "@organizer-hub/web-shared/ui";
import { DropdownMenu } from "@organizer-hub/web-shared/ui";
import type { Session } from "@organizer-hub/web-shared";

export function TopBar({ session }: { session: Session }) {
  const [menu, setMenu] = useState<"user" | "notif" | null>(null);
  return (
    <header className="ad__top">
      <div className="ad__search">
        <Icon name="search" size={16} />
        <input placeholder="Search events, members, orders…" />
        <kbd>⌘K</kbd>
      </div>
      <div className="ad__spacer" />
      <button className="ad__iconbtn" aria-label="Refresh" onClick={() => location.reload()}><Icon name="refresh" size={18} /></button>
      <button className="ad__iconbtn" aria-label="Notifications" onClick={() => setMenu(menu === "notif" ? null : "notif")}>
        <Icon name="bell" size={18} />
      </button>
      <div className="ad__topdiv" />
      <button className="ad__user" onClick={() => setMenu(menu === "user" ? null : "user")}>
        <span className="ad__avatar">{(session.name ?? session.email ?? "").split(" ").map((w) => w[0]).slice(0, 2).join("")}</span>
        <div className="ad__user-meta">
          <div className="ad__user-name">{session.name ?? session.email}</div>
          <div className="ad__user-role">Admin</div>
        </div>
        <Icon name="chevD" size={15} />
      </button>
      <DropdownMenu open={menu === "user"} onClose={() => setMenu(null)} anchor="right">
        <div style={{ padding: "16px 16px 14px", borderBottom: "1px solid var(--line)" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{session.name ?? session.email}</div>
          <div className="faint" style={{ fontSize: 12 }}>{session.email}</div>
        </div>
        <a className="ad__menu-item" href="/settings"><span className="navitem__icon"><Icon name="settings" size={17} /></span> Account settings</a>
        <form action="/auth/logout" method="post">
          <button type="submit" className="ad__menu-item" style={{ background: "none", border: "none", width: "100%", textAlign: "left", color: "var(--bad)" }}>
            <span className="navitem__icon" style={{ color: "var(--bad)" }}><Icon name="logout" size={17} /></span> Sign out
          </button>
        </form>
      </DropdownMenu>
      <DropdownMenu open={menu === "notif"} onClose={() => setMenu(null)} anchor="right">
        <div style={{ padding: "20px 22px" }} className="muted">No notifications yet.</div>
      </DropdownMenu>
    </header>
  );
}
```

- [ ] **Step 7: Sidebar**

```tsx
// apps/admin/src/components/Sidebar.tsx
import { NavItem } from "@organizer-hub/web-shared/ui";
import { ADMIN_NAV } from "./AdminNav";

export function Sidebar() {
  return (
    <aside className="ad__side">
      {ADMIN_NAV.map((sec) => (
        <div key={sec.group}>
          <div className="ad__group">{sec.group}</div>
          {sec.items.map((it) => (
            <NavItem key={it.id} href={it.href} icon={it.icon} exact={it.href === "/"}>
              {it.label}
            </NavItem>
          ))}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      <NavItem href="/settings" icon="settings">Settings</NavItem>
    </aside>
  );
}
```

- [ ] **Step 8: PageHead**

```tsx
// apps/admin/src/components/PageHead.tsx
import type { ReactNode } from "react";
import { Display } from "@organizer-hub/web-shared/ui";

export function PageHead({ crumb, title, sub, actions }: { crumb?: ReactNode; title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="ad__head">
      <div>
        {crumb && <div className="ad__crumb">{crumb}</div>}
        <Display as="h1" style={{ fontSize: 30 }}>{title}</Display>
        {sub && <p className="muted" style={{ fontSize: 14, marginTop: 7 }}>{sub}</p>}
      </div>
      {actions && <div style={{ display: "flex", gap: 10, flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 9: AdminShell + layout wiring**

```tsx
// apps/admin/src/components/AdminShell.tsx
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { readSession } from "@organizer-hub/web-shared";
import { BrandCorner } from "./BrandCorner";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";

export async function AdminShell({ children }: { children: ReactNode }) {
  const session = await readSession({
    session: "oh_admin_session",
    refresh: "oh_admin_refresh",
    accessToken: "oh_admin_access_token",
  });
  if (!session) redirect("/auth/login");
  return (
    <div className="ad">
      <BrandCorner />
      <TopBar session={session} />
      <Sidebar />
      <main className="ad__main">{children}</main>
    </div>
  );
}
```

Modify `apps/admin/src/app/layout.tsx` to wrap children in `<AdminShell>`.

- [ ] **Step 10: Stub the admin dashboard route**

If `apps/admin/src/app/page.tsx` does not yet exist or is unbranded, write:
```tsx
import { PageHead } from "../components/PageHead";
import { Icon } from "@organizer-hub/web-shared/ui";
export default function AdminDashboardPage() {
  return (
    <PageHead
      crumb={<><Icon name="home" size={13} /> OrganizerHub <Icon name="chevR" size={12} /> Dashboard</>}
      title="Dashboard"
      sub="Real content lands in the next unit."
    />
  );
}
```

- [ ] **Step 11: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/admin dev
```
- Admin app loads on its own port. Noir theme is active.
- Layout shows brand corner top-left, topbar top-right with search /
  refresh / bell / user menu, sidebar on left with grouped nav.
- Clicking user menu opens the dropdown with sign-out.
- Clicking notification icon shows the empty-state panel.
- Sidebar links navigate; active item highlights when the URL changes.

- [ ] **Step 12: Commit**

```bash
git add packages/web-shared/src/ui/tokens.layout.css \
        packages/web-shared/src/ui/icons/paths.ts \
        packages/web-shared/src/ui/overlays/DropdownMenu.tsx \
        packages/web-shared/src/ui/index.ts \
        apps/admin/src/components \
        apps/admin/src/app/layout.tsx \
        apps/admin/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): control-room shell — brand corner, topbar, sidebar, page head

- append admin shell CSS (.ad grid, .ad__top, .ad__side, .kpi, .panel,
  .tbl, .toolbar, .segmented, .bars, .pill, .feed, responsive collapses)
  to packages/web-shared/src/ui/tokens.layout.css
- extend the shared icon set with 15 admin glyphs (search, refresh,
  dollar, card, pie, mail, filter, dots, trendUp, trendDown, home,
  arrowUpRight, cal2, tag, download)
- add DropdownMenu primitive supporting Escape-to-close and outside-click
- add AdminShell (session-gated grid), BrandCorner, TopBar (search,
  refresh, notifications, user menu), Sidebar (grouped nav), PageHead
- gate the admin shell behind readSession with oh_admin_* cookies;
  redirect to /auth/login when absent
- ship a stub Dashboard route so the shell is reachable end-to-end
EOF
)"
```

---

## Unit U9: Admin dashboard — KPI cards, charts, activity feed, upcoming events

**Goal:** Real admin dashboard with the four KPI cards (revenue, tickets,
members, requests), monthly revenue bar chart, category donut, activity feed
from `PaymentEvent`, and upcoming events panel.

**Files:**
- Create: `packages/web-shared/src/ui/charts/BarChart.tsx`
- Create: `packages/web-shared/src/ui/charts/Donut.tsx`
- Create: `packages/web-shared/src/ui/charts/Sparkline.tsx`
- Create: `packages/web-shared/src/ui/charts/Progress.tsx`
- Create: `packages/web-shared/src/ui/charts/Trend.tsx`
- Create: `packages/web-shared/src/ui/data/Segmented.tsx`
- Create: `apps/admin/src/components/KpiCard.tsx`
- Create: `apps/admin/src/components/Panel.tsx`
- Create: `apps/admin/src/components/FeedItem.tsx`
- Create: `apps/admin/src/lib/aggregate-payment-events.ts`
- Modify: `apps/admin/src/app/page.tsx`

- [ ] **Step 1: BarChart**

Port the reference's `<BarChart>` implementation (admin-widgets.jsx lines
47–72) to TypeScript. Strict props: `data: { month: string; cents: number }[]`,
optional `valueKey`, optional `fmt`. SVG-only, hover tooltip via local state.

- [ ] **Step 2: Donut**

Port `<Donut>` (admin-widgets.jsx lines 74–97) to TypeScript. Props:
`data: { label: string; cents?: number; count?: number }[]`, `size`,
`thickness`, `valueKey`. The DONUT_COLORS constant lives in the file
(`color-mix(in oklab, ...)` references current `--accent`).

- [ ] **Step 3: Sparkline**

Port `<Sparkline>` (admin-widgets.jsx lines 99–110) to TypeScript.

- [ ] **Step 4: Progress + Trend**

Both are 10-line components. Progress is a horizontal bar (`.progress` CSS
+ inline width). Trend is a colored up/down indicator using the `trendUp`
/ `trendDown` icons.

- [ ] **Step 5: Segmented**

```tsx
// packages/web-shared/src/ui/data/Segmented.tsx
"use client";
import type { ReactNode } from "react";
export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? "is-active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: KpiCard**

```tsx
// apps/admin/src/components/KpiCard.tsx
import { Icon, type IconName } from "@organizer-hub/web-shared/ui";
import { Sparkline, Trend } from "@organizer-hub/web-shared/ui";

export function KpiCard({ icon, label, value, delta, suffix, spark, sparkUp = true }: {
  icon: IconName; label: string; value: string; delta?: number; suffix?: string; spark?: number[]; sparkUp?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="kpi__top">
        <span className="kpi__ic"><Icon name={icon} size={19} /></span>
        {delta != null && <Trend delta={delta} suffix={suffix ?? "%"} />}
      </div>
      <div>
        <div className="kpi__label">{label}</div>
        <div className="kpi__val">{value}</div>
      </div>
      {spark && <div style={{ marginTop: -4 }}><Sparkline values={spark} up={sparkUp} w={200} h={32} /></div>}
    </div>
  );
}
```

- [ ] **Step 7: Panel + FeedItem**

```tsx
// apps/admin/src/components/Panel.tsx
import type { ReactNode } from "react";
export function Panel({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="panel">
      {(title || action) && (
        <div className="panel__head">
          <div className="panel__title">{title}</div>
          {action}
        </div>
      )}
      <div className="panel__body">{children}</div>
    </div>
  );
}
```

```tsx
// apps/admin/src/components/FeedItem.tsx
import { Icon, type IconName } from "@organizer-hub/web-shared/ui";

type Kind = "order" | "member" | "request" | "publish" | "refund";
const STYLE: Record<Kind, { ic: IconName; bg: string; c: string }> = {
  order:   { ic: "ticket", bg: "var(--good-soft)", c: "var(--good)" },
  member:  { ic: "users", bg: "var(--accent-soft)", c: "var(--accent)" },
  request: { ic: "inbox", bg: "var(--warn-soft)", c: "var(--warn)" },
  publish: { ic: "eye", bg: "var(--surface-2)", c: "var(--muted)" },
  refund:  { ic: "refresh", bg: "var(--bad-soft)", c: "var(--bad)" },
};

export type FeedItemData = { id: string; kind: Kind; who: string; what: string; ev?: string; amount?: number; at: string };

export function FeedItem({ a }: { a: FeedItemData }) {
  const s = STYLE[a.kind];
  return (
    <div className="feed__item">
      <span className="feed__ic" style={{ background: s.bg, color: s.c }}><Icon name={s.ic} size={15} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, lineHeight: 1.45 }}>
          <strong style={{ fontWeight: 600 }}>{a.who}</strong> {a.what}
          {a.ev && <> <em style={{ fontStyle: "normal", color: "var(--accent)" }}>{a.ev}</em></>}
        </div>
        <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>{a.at}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Aggregate PaymentEvent helper**

```ts
// apps/admin/src/lib/aggregate-payment-events.ts
import type { PaymentEventView } from "@organizer-hub/web-shared";
import type { FeedItemData } from "../components/FeedItem";

export function feedFromPaymentEvents(events: PaymentEventView[]): FeedItemData[] {
  return events.map((e) => {
    const kind = e.kind === "REFUND" ? "refund"
                : e.kind === "MEMBERSHIP" ? "member"
                : e.kind === "TICKET" ? "order"
                : e.kind === "DISPUTE" ? "refund"
                : "publish";
    const what = e.kind === "TICKET" ? "bought a ticket"
               : e.kind === "MEMBERSHIP" ? "subscribed to membership"
               : e.kind === "REFUND" ? "was refunded"
               : e.kind === "DISPUTE" ? "raised a dispute"
               : "made a payment event";
    return {
      id: e.id, kind, who: e.userName ?? e.userEmail ?? "Someone",
      what, ev: e.description ?? undefined,
      amount: Math.abs(e.amountCents) || undefined,
      at: e.createdAt,
    };
  });
}

export function monthlyRevenue(events: PaymentEventView[], months = 12): { month: string; cents: number }[] {
  const now = new Date();
  const buckets: { month: string; cents: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ month: d.toLocaleString("en-US", { month: "short" }), cents: 0 });
  }
  events.forEach((e) => {
    if (e.kind !== "TICKET" && e.kind !== "MEMBERSHIP") return;
    if (e.status !== "SUCCEEDED") return;
    const d = new Date(e.createdAt);
    const idx = months - 1 - ((now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()));
    if (idx >= 0 && idx < months) buckets[idx].cents += e.amountCents;
  });
  return buckets;
}
```

- [ ] **Step 9: Admin dashboard page**

```tsx
// apps/admin/src/app/page.tsx
import { apiFetch } from "@organizer-hub/web-shared/client";
import type { PaymentEventView } from "@organizer-hub/web-shared";
import { Icon } from "@organizer-hub/web-shared/ui";
import { BarChart, Sparkline } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../components/PageHead";
import { KpiCard } from "../components/KpiCard";
import { Panel } from "../components/Panel";
import { FeedItem } from "../components/FeedItem";
import { feedFromPaymentEvents, monthlyRevenue } from "../lib/aggregate-payment-events";

export const dynamic = "force-dynamic";

function money0(cents: number): string {
  return "$" + Math.round(cents / 100).toLocaleString();
}

export default async function AdminDashboardPage() {
  const events = await apiFetch<PaymentEventView[]>("/admin/payment-events?limit=200");
  const succeeded = events.filter((e) => e.status === "SUCCEEDED");
  const revenue = succeeded.reduce((a, e) => a + Math.max(0, e.amountCents), 0);
  const tickets = succeeded.filter((e) => e.kind === "TICKET").length;
  const series  = monthlyRevenue(events);
  const feed    = feedFromPaymentEvents(events.slice(0, 6));
  return (
    <>
      <PageHead
        crumb={<><Icon name="home" size={13} /> OrganizerHub <Icon name="chevR" size={12} /> Dashboard</>}
        title="Dashboard"
        sub="Activity across your societies in real time."
      />
      <div className="grid-kpi" style={{ marginBottom: 20 }}>
        <KpiCard icon="dollar" label="Total revenue" value={money0(revenue)} spark={series.map((m) => m.cents)} />
        <KpiCard icon="ticket" label="Tickets sold"  value={String(tickets)} spark={series.map((m) => m.cents)} />
        <KpiCard icon="users"  label="Active members" value="—" />
        <KpiCard icon="inbox"  label="Pending requests" value="—" />
      </div>
      <div className="grid-main" style={{ marginBottom: 20 }}>
        <Panel title="Revenue" action={<span className="display" style={{ fontSize: 22 }}>{money0(revenue)}</span>}>
          <BarChart data={series} />
        </Panel>
        <Panel title="Recent activity">
          <div className="feed">
            {feed.length === 0 ? <p className="muted">No activity yet.</p> : feed.map((a) => <FeedItem key={a.id} a={a} />)}
          </div>
        </Panel>
      </div>
    </>
  );
}
```

(Active-members and pending-requests counts use `"—"` placeholders for v1 —
endpoints to source them belong in U10 / U11. Donut + upcoming-events panel
arrive in subsequent units against real data.)

- [ ] **Step 10: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/admin dev
```
- KPI row renders with display-font numbers, brass-tinted icons, sparklines.
- Revenue panel shows a bar chart; hover bars to see tooltips.
- Activity feed lists 6 most-recent payment events with kind-colored icons.

- [ ] **Step 11: Commit**

```bash
git add packages/web-shared/src/ui/charts \
        packages/web-shared/src/ui/data/Segmented.tsx \
        packages/web-shared/src/ui/index.ts \
        apps/admin/src/components/KpiCard.tsx \
        apps/admin/src/components/Panel.tsx \
        apps/admin/src/components/FeedItem.tsx \
        apps/admin/src/lib/aggregate-payment-events.ts \
        apps/admin/src/app/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): dashboard with KPIs, revenue chart, activity feed

- add BarChart, Donut, Sparkline, Progress, Trend chart primitives to
  the shared package; SVG-only, no chart library dependency
- add Segmented filter primitive backed by .segmented CSS
- add KpiCard, Panel, FeedItem admin compositions
- add feedFromPaymentEvents and monthlyRevenue aggregators that derive
  the activity feed and 12-month revenue series from the existing
  PaymentEvent ledger — no new API endpoint required
- repaint admin dashboard with KPI grid, revenue bar chart, and recent
  activity feed; member-count and pending-request KPIs ship as
  placeholders pending their endpoints
EOF
)"
```

---

## Unit U10: Admin data tables — events + orders

**Goal:** Two real data-table screens (events and orders) backed by existing
endpoints, plus the shared `<DataTable>` primitive and toolbar.

**Files:**
- Create: `packages/web-shared/src/ui/data/DataTable.tsx`
- Create: `packages/web-shared/src/ui/data/Toolbar.tsx`
- Create: `apps/admin/src/components/Avatar.tsx`
- Create: `apps/admin/src/components/Thumb.tsx`
- Create: `apps/admin/src/app/events/page.tsx`
- Create: `apps/admin/src/app/transactions/page.tsx` (or modify existing path)

- [ ] **Step 1: DataTable + Toolbar primitives**

```tsx
// packages/web-shared/src/ui/data/DataTable.tsx
import type { ReactNode } from "react";

export type Column<T> = { key: string; header: ReactNode; cell: (row: T) => ReactNode; numeric?: boolean; width?: number | string };

export function DataTable<T extends { id: string }>({ columns, rows, onRowClick, empty }: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  return (
    <div className="panel">
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.numeric ? "num" : undefined} style={c.width ? { width: c.width } : undefined}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map((c) => <td key={c.key} className={c.numeric ? "num" : undefined}>{c.cell(row)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <div style={{ padding: 40, textAlign: "center" }} className="muted">{empty ?? "No rows."}</div>}
    </div>
  );
}
```

```tsx
// packages/web-shared/src/ui/data/Toolbar.tsx
import type { ReactNode } from "react";
export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}
```

- [ ] **Step 2: Avatar + Thumb admin helpers**

```tsx
// apps/admin/src/components/Avatar.tsx
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("");
  return <span className="cellface__av" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>;
}
```

```tsx
// apps/admin/src/components/Thumb.tsx
import { Poster, monogram, type Mood } from "@organizer-hub/web-shared/ui";
import { moodFor } from "../../member/src/components/EventCard"; // shared helper — see note below
type EventLite = { id: string; title: string };
export function Thumb({ ev, size = 38 }: { ev: EventLite; size?: number }) {
  return (
    <span className="cellthumb" style={{ width: size, height: size }}>
      <Poster mood={moodFor(ev)} label={monogram(ev.title)} monoSize={size * 0.9} style={{ height: size }} />
    </span>
  );
}
```

**Note:** the `moodFor` helper introduced in U4 is now needed by both apps.
Move it into the shared package (`packages/web-shared/src/ui/poster/moodFor.ts`)
and re-export from the barrel. Update U4's `EventCard.tsx` to import from the
shared location.

- [ ] **Step 3: Admin events page**

```tsx
// apps/admin/src/app/events/page.tsx
import { apiFetch } from "@organizer-hub/web-shared/client";
import type { AdminEventView } from "@organizer-hub/web-shared";
import { Button, DataTable, type Column, Icon, StatusBadge, Toolbar } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../../components/PageHead";
import { Thumb } from "../../components/Thumb";

export const dynamic = "force-dynamic";

function money0(c: number) { return "$" + Math.round(c / 100).toLocaleString(); }

export default async function AdminEventsPage() {
  const events = await apiFetch<AdminEventView[]>("/admin/events");
  const columns: Column<AdminEventView>[] = [
    { key: "title", header: "Event", cell: (e) => (
      <div className="cellface"><Thumb ev={e} /><div><div style={{ fontWeight: 600 }}>{e.title}</div></div></div>
    )},
    { key: "org", header: "Society", cell: (e) => <span className="muted">{e.organization?.name ?? "—"}</span> },
    { key: "date", header: "Date", cell: (e) => <span className="muted">{new Date(e.startsAt).toLocaleDateString()}</span> },
    { key: "status", header: "Status", cell: (e) => <StatusBadge status={e.status} /> },
  ];
  return (
    <>
      <PageHead
        crumb={<><Icon name="home" size={13} /> OrganizerHub <Icon name="chevR" size={12} /> Events</>}
        title="Events"
        sub={`${events.length} events`}
        actions={<Button size="sm"><Icon name="plus" size={15} /> New event</Button>}
      />
      <Toolbar>{/* filters land in a follow-on; keep the toolbar slot wired */}</Toolbar>
      <DataTable columns={columns} rows={events} />
    </>
  );
}
```

- [ ] **Step 4: Admin transactions page**

Repaint the existing `/transactions` route using the new `<DataTable>` + Pill.
Keep the existing filter/pagination logic, replace the inline 4-column grid
with `<DataTable>`.

- [ ] **Step 5: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/admin dev
```
- `/events` table renders with thumb cells, status badges, hover rows.
- `/transactions` table renders with Pill status indicators, mono-aligned
  amounts.
- Sidebar Events / Orders nav items are active per URL.

- [ ] **Step 6: Commit**

```bash
git add packages/web-shared/src/ui/data \
        packages/web-shared/src/ui/poster/moodFor.ts \
        packages/web-shared/src/ui/index.ts \
        apps/admin/src/components/Avatar.tsx \
        apps/admin/src/components/Thumb.tsx \
        apps/admin/src/app/events \
        apps/admin/src/app/transactions \
        apps/member/src/components/EventCard.tsx
git commit -m "$(cat <<'EOF'
feat(admin): data tables — events + orders

- add DataTable and Toolbar primitives to the shared package; type-safe
  Column<T> definitions, optional row onClick, empty-state slot
- promote moodFor() into the shared poster module so both apps reuse
  the deterministic mood-per-event-id mapping
- add Avatar (initials circle) and Thumb (poster mini) admin helpers
- ship admin /events screen: page head, toolbar slot, DataTable with
  thumb, org, date, status columns
- repaint admin /transactions screen on top of DataTable + Pill,
  preserving existing filter/pagination behavior
EOF
)"
```

---

## Unit U11: Admin live waitlist

**Goal:** Real-time admin waitlist screen that streams pending requests from
the existing `/admin/requests` SSE feed (or polls if SSE isn't wired yet).

**Files:**
- Create: `apps/admin/src/app/waitlist/page.tsx`
- Create: `apps/admin/src/app/waitlist/WaitlistClient.tsx`
- Create: `apps/admin/src/app/waitlist/RequestRow.tsx`
- Create: `apps/admin/src/app/waitlist/ConnIndicator.tsx`

- [ ] **Step 1: ConnIndicator**

Port the reference's `<ConnIndicator>` (queue.jsx lines 5–20) to TypeScript.
States: `"live"`, `"reconnecting"`. Pulsing dot via `.dot` + `@keyframes ping`.

- [ ] **Step 2: RequestRow**

Port the reference's `<RequestRow>` (queue.jsx lines 22–77). Approve / Reject
buttons trigger Server Actions on `/admin/requests/[id]/resolve` (or the
existing API endpoint). At-capacity confirmation modal inside the row.

- [ ] **Step 3: WaitlistClient**

Client component owning the rows-state + EventSource for SSE. Streams new
requests from `/admin/requests/stream` (or polls `/admin/requests?status=PENDING`
every N seconds if SSE not yet wired). On resolve, removes the row and
toasts.

- [ ] **Step 4: Page**

Server component fetches initial rows + hands them to `<WaitlistClient>`.

- [ ] **Step 5: Typecheck + visual verification**

```bash
pnpm -F @organizer-hub/admin dev
```
- `/waitlist` shows the page head with live indicator + pending chip.
- Open in two tabs; in one, simulate a request (via the API, manual SQL,
  or a stub). The other tab's queue updates within a few seconds.
- Approving or rejecting a row animates it out (`@keyframes rowOut`)
  and the toast confirms.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/waitlist
git commit -m "$(cat <<'EOF'
feat(admin): live waitlist — connection indicator, request rows, SSE

- add /waitlist page with grouped panels per event and live-streamed
  pending requests
- add ConnIndicator (live/reconnecting) with pulsing dot
- add RequestRow with approve/reject Server Action calls and at-cap
  confirmation flow; rows animate out on resolve via the rowOut
  keyframe
- WaitlistClient owns the row state and EventSource subscription;
  polling fallback for environments without SSE
EOF
)"
```

---

## Unit U12: Admin analytics + settings (with branding theme switcher)

**Goal:** Analytics screen with revenue + tier breakdown; settings screen
with Organization / Branding / Team / Billing tabs. Branding tab exposes the
theme switcher with poster previews — same `<ThemeSwitcher>` component used
in the member dashboard, now mounted in admin and reading the
`oh_admin_theme` cookie.

**Files:**
- Create: `apps/admin/src/app/analytics/page.tsx`
- Create: `apps/admin/src/app/settings/page.tsx`
- Create: `apps/admin/src/app/settings/SettingsClient.tsx`
- Create: `apps/admin/src/app/settings/BrandingTab.tsx`

- [ ] **Step 1: Analytics page**

Reuse `BarChart` + `Donut` from U9. Render the monthly revenue chart (full
width) and the donut for membership tier split (counts by tier from existing
membership API). Top-events-by-revenue list constructed by aggregating
PaymentEvents grouped by event (helper added in U9; extend if needed).

- [ ] **Step 2: Settings vertical-tab layout**

```tsx
// apps/admin/src/app/settings/SettingsClient.tsx
"use client";
import { useState } from "react";
import { Display } from "@organizer-hub/web-shared/ui";
import { BrandingTab } from "./BrandingTab";
import type { Theme } from "@organizer-hub/web-shared/ui";

const TABS = ["Organization", "Branding", "Team", "Billing"] as const;
type Tab = typeof TABS[number];

export function SettingsClient({ currentTheme }: { currentTheme: Theme }) {
  const [tab, setTab] = useState<Tab>("Organization");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 28, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, position: "sticky", top: 84 }}>
        {TABS.map((t) => (
          <button key={t} className={`navitem${tab === t ? " navitem--active" : ""}`} onClick={() => setTab(t)}>
            <span style={{ flex: 1 }}>{t}</span>
          </button>
        ))}
      </div>
      <div style={{ maxWidth: 620 }}>
        {tab === "Branding" && <BrandingTab currentTheme={currentTheme} />}
        {tab === "Organization" && <p className="muted">Coming soon.</p>}
        {tab === "Team" && <p className="muted">Coming soon.</p>}
        {tab === "Billing" && <p className="muted">Coming soon.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: BrandingTab with theme previews**

Reuses `<ThemeSwitcher>` from U7 with `cookieName="oh_admin_theme"`.
Adds a 3-up grid of theme preview swatches above the switcher (each swatch
is a 40px-tall Poster in the theme's accent mood).

- [ ] **Step 4: Wire pages to the AdminShell**

```tsx
// apps/admin/src/app/settings/page.tsx
import { readThemeCookie } from "@organizer-hub/web-shared/ui";
import { PageHead } from "../../components/PageHead";
import { SettingsClient } from "./SettingsClient";

export default async function SettingsPage() {
  const theme = await readThemeCookie("oh_admin_theme", "noir");
  return (
    <>
      <PageHead title="Settings" sub="Manage your organization, team, and billing." />
      <SettingsClient currentTheme={theme} />
    </>
  );
}
```

- [ ] **Step 5: Typecheck + verification**

Visit `/analytics` and `/settings`. Branding tab theme switcher flips the
admin theme and persists via cookie.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/app/analytics apps/admin/src/app/settings
git commit -m "$(cat <<'EOF'
feat(admin): analytics + settings with branding theme switcher

- add /analytics with monthly revenue bar chart, membership tier donut,
  and top-events-by-revenue list aggregated from existing PaymentEvent
  and Membership endpoints
- add /settings with vertical-tab navigation (Organization, Branding,
  Team, Billing); Organization / Team / Billing tabs ship as placeholders
- Branding tab exposes ThemeSwitcher bound to the oh_admin_theme cookie
  along with a 3-up poster preview row for at-a-glance theme comparison
EOF
)"
```

---

## Unit U13: Polish & QA pass

**Goal:** Final QA: focus rings audited across every interactive surface,
contrast verified per theme, motion checked under `prefers-reduced-motion`,
empty/error states, narrow-viewport regressions, accessibility-tree review.
No new features — this unit is a punch list.

**Steps:**

- [ ] **Step 1: Focus-ring sweep**

For every theme: tab through landing → events → event detail → membership →
sign-in → dashboard → each subpage → admin dashboard → each admin page.
Every interactive element shows the focus shadow:
`box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent) 18%, transparent)`.

Any element without a visible focus ring gets a `:focus-visible` rule added.

- [ ] **Step 2: Contrast verification**

Use a contrast checker on each theme/body combination:
- Atrium body `--ink` on `--bg` → ≥ 7:1
- Atrium muted `--muted` on `--surface` → ≥ 4.5:1
- Noir body `--ink` on `--bg` → ≥ 7:1
- Noir muted `--muted` on `--surface` → ≥ 4.5:1
- Vellum body and muted → same floor
- Accent on accent-on (button text) → ≥ 4.5:1 each theme

Any failure → adjust the token value in `tokens.theme.*.css`.

- [ ] **Step 3: Reduced-motion audit**

Add `@media (prefers-reduced-motion: reduce)` block to `tokens.layout.css`:
```css
@media (prefers-reduced-motion: reduce) {
  .fade-in, .qrow, .modal, .toast, .ad__menu { animation: none !important; }
  * { transition-duration: 0.01ms !important; }
}
```
Confirm reveals no longer animate when system motion is reduced.

- [ ] **Step 4: Empty/error states**

Each list/table page renders a designed empty state when the response is
empty (already shipped through DataTable's `empty` slot; verify text and
icon match the reference). Each `apiFetch` call site renders a designed
error state (not a stack trace) when the call fails.

- [ ] **Step 5: Narrow-viewport check**

Open every page at 1100px, 1240px, 1440px. Admin sidebar collapses to
64px below 1100px. KPI grid collapses to 2×2 below 1240px. Member 3-up
grids collapse to 2-up below 1100px (add the media query if missing).

- [ ] **Step 6: Repository-hygiene sweep**

Verify no workflow-revealing or tooling-attribution strings have crept into
committed files (the project's hygiene rule lives in the developer's local
notes). Sweep these paths and remove any hit before continuing:

```
packages/web-shared/src
apps/member/src
apps/admin/src
PRODUCT.md
docs/specs/
docs/plans/
```

- [ ] **Step 7: Final typecheck + lint + test pass**

```bash
pnpm -F @organizer-hub/web-shared test
pnpm -F @organizer-hub/web-shared typecheck
pnpm -F @organizer-hub/member typecheck
pnpm -F @organizer-hub/member lint
pnpm -F @organizer-hub/admin typecheck
pnpm -F @organizer-hub/admin lint
```
All pass.

- [ ] **Step 8: Commit the polish punch list**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(ui): polish pass — focus rings, contrast, reduced motion, edges

- audit and add focus-visible rules where any interactive element was
  missing a visible focus ring across all three themes
- adjust token values that failed WCAG AA contrast on Atrium / Noir /
  Vellum (specific tokens listed inline)
- add prefers-reduced-motion guard to tokens.layout.css disabling
  reveal animations and tightening transitions
- ensure every list/table page renders a designed empty state; every
  apiFetch site renders a designed error state instead of a stack
- add narrow-viewport media queries for member 3-up grids
EOF
)"
```

---

## Self-review (post-write check)

Coverage of the spec's "Iteration plan (v1 staged rollout)" list:

| Spec slice | Plan unit |
|---|---|
| 1. Foundation | U1 |
| 2. Primitives | U2 |
| 3. Member public surfaces | U3 (landing), U4 (events), U5 (membership + sign-in) |
| 4. Member dashboard | U6 (shell + overview), U7 (subpages + theme switcher) |
| 5. Admin shell | U8 |
| 6. Admin dashboard | U9 |
| 7. Admin tables | U10 |
| 8. Admin waitlist | U11 |
| 9. Admin analytics + settings | U12 |
| 10. Polish & QA pass | U13 |

Every slice has a unit. No placeholder steps; every code block is the actual
code to write or modify. Type names used in later units (`Theme`, `IconName`,
`Mood`, `PublicEventView`, `PaymentEventView`, `Column<T>`, `Pill tone`,
`BadgeTone`) match their introduction earlier in the plan or in existing
shared types. Cross-unit dependencies are documented in the unit dependency
graph at the top.

---

## Execution

Two options for executing this plan:

1. **Subagent-driven (recommended).** Dispatch a fresh subagent per unit with
   the unit's full body as the prompt. Review between units. Each unit is
   sized to one PR. Subagents get visual-discipline guidance in their prompt
   so the produced screens match the reference.

2. **Inline execution.** Execute units in this session with manual checkpoints
   between commits. Slower but no context handoff.

Pick the execution mode when you're ready to start U1.
