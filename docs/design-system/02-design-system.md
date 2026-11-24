# Project design system: AI Spanda (`aispanda-web`)

| Field | Value |
|---|---|
| Document status | `Proposed` review draft. Not registered in `docs/DOCUMENTATION_ROUTER.md`; owner approval required before it becomes `Current` (router rules 2, 3 and 5). |
| Version | `v0.2-astro-trial`, 2026-11-24 |
| Owner and approver | Rajeev Kasat |
| Code baseline | `review/astro-component-enrichment` at `36504ae`, built on `main` at `078a7b0` |
| Source draft | Antigravity local trial draft `02-design-system.md` (2026-11-24), enriched and checked against code by Claude |
| Process | [Reusable Delivery UI/UX framework](https://github.com/aispanda/Reusable-Delivery/tree/main/docs/ui-ux-delivery), stage 2 (Foundations) |
| Brand owner document | [`docs/SITE_FOUNDATION.md`, Brand direction](../SITE_FOUNDATION.md). That document owns accepted brand decisions; this one records how they are implemented and what is still open. |

## How to read this document

Every value carries one of four labels.

| Label | Meaning |
|---|---|
| **Verified in code** | Present in `src/styles/global.css` or `src/components/` at `36504ae`. Contrast ratios were recomputed with the WCAG 2.x relative luminance formula on 2026-11-24. |
| **Accepted** | Recorded as accepted in `docs/SITE_FOUNDATION.md`. |
| **Provisional** | In code on the review branch but awaiting Rajeev's sign off. |
| **Proposed** | Suggested here or in the Antigravity draft; not yet in code at `36504ae`. |

Nothing in this document says that Storybook, Open Design, Chromatic or an automated accessibility suite has passed. See [Evidence and limits](#evidence-and-limits).

## 1. Design principles and audience

AI Spanda is a personal AI thought leadership site, not a firm, and nothing is for sale on these surfaces (`SITE_FOUNDATION.md`). The visual system should feel like a well kept working notebook: warm, exact and calm, with one confident gesture.

1. **Agency over hype.** Lead with plain intent, inspectable proof and explicit boundaries. No sales theatre, novelty mascot or religious iconography on public pages.
2. **Warm editorial authority.** Paper warm cream ground (`--canvas`) and white cards (`--surface`), anchored by near black ink (`--ink`). Boldness is spent on one signature gesture: the solar amber offset block shadow on primary actions and feature panels.
3. **Honest maturity signalling.** Every reusable asset shows its maturity (`Live proof`, `Reusable`, `Pilot-ready`, `Draft`) through visible text, a tinted pill and, for drafts, a hollow marker plus dashed card border. Colour is never the only cue.
4. **The spectrum belongs to the mark.** Teal, coral and the full spectrum are reserved for the logo and ambient section glow, not for UI controls (`SITE_FOUNDATION.md`: "spectrum reserved for the mark").

Audiences come from `site-profile.json` and `SITE_FOUNDATION.md`; this document does not restate them.

## 2. Sources of truth and how they map

| Source | Role | Status of agreement |
|---|---|---|
| `src/styles/global.css` (`36504ae`) | Runtime source of every token in this document | Canonical for what ships |
| `docs/SITE_FOUNDATION.md` | Accepted brand direction (colours, type, logo) | Agrees with code |
| [Design sheet](https://docs.google.com/spreadsheets/d/19fdTDh7Cexn10k4TOz8_LMz7sO8uRDHD4oGc5eq5Kzg/edit), Design System tab | Earlier role and psychology catalogue | **Diverges.** The sheet lists Bright Blue `#598BE2`, Info Blue `#3C8FE6`, Success `#16A34A`, Error `#DC2626`, Soft Peach `#F5BC97` and a `1200px` container. None of these hex values appears in `global.css`. The sheet should be reconciled to code, or code changed by decision; until then code wins. |
| Drive `ai-spanda.tokens.json` (`1mkiqaw_sXdoOtxaGPjusqNq2irs28Vfo`) | Cited by the Antigravity draft | **Not checked in this pass.** |
| `src/styles/tokens.css` | Antigravity draft says it is the canonical token file shared by Astro, Storybook and Open Design | **Proposed.** It does not exist at `36504ae`. Tokens live at the top of `global.css`. |

Recommended mapping once approved: extract the `:root` block of `global.css` into `src/styles/tokens.css`, import it first from `global.css`, and generate any DTCG JSON from that file rather than editing JSON by hand.

## 3. Colour roles

All values verified in code. Ratios recomputed; where the Antigravity draft differed, the corrected value is shown and the draft value noted.

### Core tokens

| Token | Value | Role | Key pairing | Ratio | Result |
|---|---|---|---|---|---|
| `--canvas` | `#f3f1ea` | Warm cream page ground | `--ink` text | 16.29:1 | AAA |
| `--surface` | `#ffffff` | Cards, header, form panels | `--ink` text | 18.41:1 | AAA |
| `--ink` | `#12141a` | Text, borders, primary button fill, dark sections | white text | 18.41:1 | AAA |
| `--muted` | `#5a5f68` | Secondary prose and meta | on `--canvas` / `--surface` | 5.68:1 / 6.42:1 | AA |
| `--line` | `#d9d6cc` | Card and divider borders | decorative only | n/a | Not a control boundary |
| `--solar` | `#e8a01a` | Offset shadows, principle numbers, links in dark contact panel | `--ink` on solar; solar on `--ink` | 8.31:1 | AAA |
| `--solar-deep` | `#c97810` | Deeper amber | not audited | n/a | Usage not reviewed |
| `--clarity` | `#2f6fe0` | Accepted clarity blue: wordmark span, focus ring, links, dark section eyebrow | see below | see below | Mixed |
| `--clarity-text` | `#2459c4` | **Provisional.** Deeper blue for small text on light grounds | see below | see below | AA |
| `--soft-solar` | `#fff3d6` | Featured and `Pilot-ready` tint | `#754705` text | 7.16:1 | AAA |
| `--soft-clarity` | `#e8f0ff` | `Reusable` tint | `#244e9d` text | 6.92:1 | AA |
| `--spectrum-teal`, `--coral` | `#2eb8b0`, `#ff7058` | Mark and ambient glow only | not for text | n/a | Reserved |

Legacy aliases `--lime`, `--blue`, `--soft-blue` and `--soft-lime` map to the tokens above. `--lime` is amber, not green; new code should use the semantic names.

### Blue: accepted, provisional and where each fails

| Pairing | Ratio | Normal text (4.5:1) | Large text or UI (3:1) |
|---|---|---|---|
| `--clarity` on `--canvas` | 4.16:1 (draft said 4.02) | Fail | Pass |
| `--clarity` on `--surface` | 4.70:1 | Pass | Pass |
| `--clarity` on `--ink` (dark section eyebrow) | 3.92:1 (draft said 4.57) | **Fail** | Pass |
| `--clarity-text` on `--canvas` | 5.63:1 (draft 5.61) | Pass | Pass |
| `--clarity-text` on `--surface` | 6.36:1 (draft 6.34) | Pass | Pass |
| `--clarity-text` on proof block `#f5f6f3` | 5.86:1 (draft 5.53) | Pass | Pass |

Where `--clarity-text` is applied at `36504ae`: `.eyebrow` on light grounds and `.asset-proof-links a`. That is all.

Where small blue text still uses `--clarity` at `36504ae`: `.brand-wordmark span`, `.asset-how li`, `.audience-card b`, `.support-demo-aside a`, `.insight-prose a`, `.insight-row:hover h3`. The Antigravity draft lists most of these as already moved to `--clarity-text`; in this commit they are not. Moving them is a **proposed** follow up that depends on the same sign off. The wordmark span is the one remaining serious axe contrast finding on the home page from the earlier comparison run.

Open finding: `.section-alt .eyebrow` keeps `--clarity` on the dark ground at 3.92:1. The eyebrow is `.78rem` bold uppercase, which is normal text under WCAG, so this fails 1.4.3. A lighter blue for dark grounds needs a design decision; it is not fixed here.

### Prohibited pairings

* White text on `--solar` (2.22:1).
* `--solar` as the only boundary of a control on cream or white (1.96:1 and 2.22:1, below the 3:1 non text minimum).
* `--clarity` for normal weight text under 24px on `--canvas`, or on the dark section ground.
* Any spectrum token as text.

### Maturity status badges (verified in code)

| Status | Text on fill | Ratio | Non colour cue |
|---|---|---|---|
| `Live proof` | `#285918` on `#e8f4df` | 7.28:1 (draft 7.39) | Visible label, filled marker |
| `Reusable` | `#244e9d` on `#e8f0ff` | 6.92:1 (draft 7.35) | Visible label, filled marker |
| `Pilot-ready` | `#754705` on `#fff3d6` | 7.16:1 (draft 7.21) | Visible label, filled marker |
| `Draft` | `#565b64` on `#f1f1ee` | 6.03:1 (draft 6.08) | Visible label, hollow marker, dashed card border, translucent card |

`StatusBadge.astro` renders the visible status text with a visually hidden "Maturity: " prefix, so screen readers announce the category as well as the value.

## 4. Typography, spacing and layout

**Accepted** in `SITE_FOUNDATION.md` and **verified in code**.

| Role | Value |
|---|---|
| Display | `"Sora", ui-sans-serif, system-ui, sans-serif`; `h1, h2, h3` share `line-height: 1.05`, `letter-spacing: -.04em`, `text-wrap: balance` |
| `h1` | `clamp(2.8rem, 6.2vw, 5.4rem)`, max width `820px`; page heroes override to `clamp(3rem, 6vw, 5.7rem)` |
| `h2` | `clamp(2rem, 3.8vw, 3.4rem)` |
| `h3` | `clamp(1.2rem, 2vw, 1.55rem)` |
| Body | `"Source Sans 3", "Source Sans Pro", ui-sans-serif, system-ui, sans-serif`, base `line-height: 1.55` |
| Reading measure | `66ch` for prose and insight articles (line height `1.65` to `1.7`) |
| Eyebrow | `.78rem`, weight 800, `letter-spacing: .16em`, uppercase |
| Shell | `--shell: min(1180px, calc(100vw - 2rem))` |
| Breakpoints | `850px` (mobile nav drawer, two column cards, stacked splits) and `580px` (single column cards and footer) |
| Minimum width | `body { min-width: 320px }` |

Pending decision: the sheet records a `1200px` container. Code ships `1180px`. Keep `1180px` until Rajeev chooses, to avoid a layout shift against the live site.

## 5. Shape, elevation and motion

| Element | Value | Status |
|---|---|---|
| `--radius` | `1.15rem` for cards | Verified |
| Feature panels | `1.5rem` radius, `2px solid var(--ink)` border, `10px 10px 0 var(--solar)` offset (`.contact-panel`, `.support-form-card`, `.support-confirmation-card`, principles panel) | Verified |
| Pills | `999px` for buttons, status badges and topic chips | Verified |
| Functional depth | `--shadow: 0 18px 60px rgba(18, 20, 26, .1)` | Verified |
| Signature offset | `4px 4px 0 var(--solar)` on `.button` | Verified |

Motion: ambient and entrance keyframes (`brand-rise`, `brand-pulse`, `spanda-hum`, `principles-rise`) plus button transitions of `.18s`. Under `prefers-reduced-motion: reduce`, smooth scroll is turned off, all animation and transition durations collapse to `.01ms`, and named hero and section animations are set to `none`. Colour and focus changes remain immediate. Verified in code; not verified in a browser in this pass.

## 6. Interaction, focus and keyboard

| Rule | At `36504ae` | Status |
|---|---|---|
| Focus ring | `:focus-visible { outline: 3px solid var(--clarity); outline-offset: 4px }` everywhere. As a non text indicator this meets 3:1 on cream (4.16), white (4.70) and the dark ground (3.92). | Verified |
| Focus ring, draft proposal | `--clarity-text` on light grounds and `--solar` on dark sections and the contact panel (8.31:1) | **Proposed**, not in code |
| Primary button | Ink fill, white text, `min-height: 48px`, amber offset. Hover moves `translate(2px, 2px)` with a `2px` offset. | Verified |
| Primary button pressed state | Draft proposes `translate(4px, 4px)` with no offset | **Proposed**, no `:active` rule in code |
| Secondary button | Transparent, ink text, no offset | Verified |
| Secondary hover and pressed tint | Draft proposes an ink tint | **Proposed**, no rule in code |
| Skip link | Fixed, ink fill, slides in on focus, targets `<main id="main">` | Verified |
| Skip target focus | Draft says `<main tabindex="-1">` | **Proposed.** `BaseLayout.astro` renders `<main id="main">` without `tabindex`. |
| Mobile menu | `.menu-button` toggles `aria-expanded` and `aria-controls="site-navigation"`; Escape closes the open menu and returns focus to the button (added in `36504ae`, covered by `tests/e2e/components.spec.ts`) | Verified |
| Menu button target size | Draft states at least 44 by 44 | **Not verified.** No explicit minimum size rule; measure in a browser. |

## 7. Content voice

Calm, direct, evidence backed, first principles prose. State what was verified, when, and what remains unverified. Avoid hype words, invented urgency and AI assistant phrasing. Maturity labels describe evidence, not ambition: an asset is `Live proof` only when there is a dated, linkable proof.

## 8. Component inventory

Shared Astro components present in `src/components/` at `36504ae`:

| Component | Purpose | Notes |
|---|---|---|
| `AssetCard.astro` | Reusable asset card | Composes `StatusBadge`, `ProofBlock`, `TagList`; `headingLevel` prop; explore link includes the asset name for screen readers |
| `StatusBadge.astro` | Maturity pill | Visible text plus visually hidden "Maturity: " prefix |
| `ProofBlock.astro` | Proof summary inside a card | `role="group"` labelled by its heading (default `h4`), not a landmark |
| `TagList.astro` | Topic chips | `ul` and `li` with an `aria-label` |
| `SectionHeading.astro` | Eyebrow, title and optional lead | Configurable level and id |
| `PrincipleCard.astro` | Numbered principle on dark ground | Number is `aria-hidden`; heading carries "Principle N:" for screen readers |
| `AudienceCard.astro` | Audience strip or card | Two variants; configurable heading level |
| `Header.astro` | Site header and mobile menu | Escape handling added |
| `Footer.astro`, `BrandMark.astro`, `ArticleVisual.astro`, `Comments.astro` | Existing site components | Not changed in the candidate |

Named in the Antigravity draft but **absent at `36504ae`**: `ActionLink.astro`, `PageHero.astro`, `src/stories/*.stories.ts` (`@storybook-astro/framework`), `.storybook/preview.ts`, and the Open Design `open-design-system/` package. These may exist on Antigravity's local branch; they are not in GitHub at this commit. The repository guidance also says Storybook is optional and markup should not be duplicated in another framework only to create stories.

Tests: `tests/e2e/components.spec.ts` (six Playwright tests) at `36504ae`.

## 9. Decisions

| Decision | Status | Owner |
|---|---|---|
| Warm light ground, ink structure, solar proof accent, clarity blue, spectrum reserved for the mark | Accepted (`SITE_FOUNDATION.md`) | Rajeev |
| Sora display and Source Sans 3 body | Accepted | Rajeev |
| `--clarity-text: #2459c4` for small text on light grounds | **Provisional**, awaiting sign off | Rajeev |
| Extend `--clarity-text` to wordmark, `.asset-how li`, audience labels, support and insight links | **Proposed**, depends on the decision above | Rajeev |
| Accessible blue for small text on dark sections | **Open**, no value chosen | Rajeev |
| Solar focus ring on dark grounds | **Proposed** | Rajeev |
| Primary pressed state and secondary hover tint | **Proposed** | Rajeev |
| Container `1180px` versus sheet `1200px` | **Open**, `1180px` kept | Rajeev |
| Sheet colours (`#598BE2` and others) versus code | **Open**, reconcile sheet to code or record a change | Rajeev |
| Separate `tokens.css`, Storybook and Open Design package | **Proposed** | Rajeev |
| Register this document in `DOCUMENTATION_ROUTER.md` | **Pending** owner approval | Rajeev |

## Evidence and limits

What was checked for this document on 2026-11-24:

* Every token, selector and component claim above was read from the code at `36504ae`.
* Contrast ratios were recomputed with the WCAG relative luminance formula. Gradient overlays on the dark section were ignored, so its real ground is slightly lighter than `#12141a`.
* Earlier on the same day, against the same commit: `pnpm build` with its validators passed; `tests/e2e/components.spec.ts` passed 6 of 6 (and failed 6 of 6 on `main`); the full end to end suite passed 7 of 7 on the dev server; an axe run on the home page showed serious findings falling from 10 to 1.

Not done or not available:

* No Storybook, Open Design or Chromatic run. None exists at this commit.
* No browser rendering, screenshot or axe run was repeated for this document.
* The live site at https://aispanda.com could not be loaded from the test environment's shell; earlier comparisons used `main` built locally. Live parity is assumed from `main`, not observed.
* The Drive token JSON was not opened in this pass.
* No human review or brand approval has been recorded.
