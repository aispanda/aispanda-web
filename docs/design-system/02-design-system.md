# Project design system: AI Spanda (`aispanda-web`)

| Field | Value |
|---|---|
| Document status | `Proposed` review draft. Not registered in `docs/DOCUMENTATION_ROUTER.md`; owner approval required before it becomes `Current` (router rules 2, 3 and 5). |
| Version | `v0.2-astro-trial`, 2026-11-24 |
| Owner and approver | Rajeev Kasat |
| Code baseline | `review/astro-component-enrichment` at `36504ae`, built on `main` at `078a7b0` |
| Local trial | Antigravity branch `antigravity/astro-framework-trial`, based on `36504ae`, **not pushed**. Its contents are reported by Antigravity and could not be inspected by Claude. |
| Source draft | Antigravity local trial draft `02-design-system.md` (2026-11-24), enriched and checked against code by Claude, then reconciled with Antigravity's report on 2026-11-24 |
| Process | [Reusable Delivery UI/UX framework](https://github.com/aispanda/Reusable-Delivery/tree/main/docs/ui-ux-delivery), stage 2 (Foundations) |
| Brand owner document | [`docs/SITE_FOUNDATION.md`, Brand direction](../SITE_FOUNDATION.md). That document owns accepted brand decisions; this one records how they are implemented and what is still open. |

## How to read this document

Every value carries one of four labels.

| Label | Meaning |
|---|---|
| **Accepted** | Recorded as accepted in `docs/SITE_FOUNDATION.md`. |
| **Verified at 36504ae** | Present in `src/styles/global.css` or `src/components/` at `36504ae`, read by Claude. Contrast ratios recomputed with the WCAG 2.x relative luminance formula on 2026-11-24. |
| **Verified in Antigravity local trial, unpushed** | Reported by Antigravity as present and tested on `antigravity/astro-framework-trial`. Not in GitHub; Claude could not inspect it. Claude recomputed the contrast ratios only. |
| **Provisional** | In code (at `36504ae` or in the local trial) but awaiting Rajeev's sign off. |
| **Open** | No decision and no agreed value yet. |

A row can carry two labels, for example a value that is both verified in the local trial and provisional.

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
| Drive `ai-spanda.tokens.json` (`1mkiqaw_sXdoOtxaGPjusqNq2irs28Vfo`) | Older DTCG token export | **Diverges** (checked by Antigravity, not by Claude). It mirrors the sheet palette (`#598BE2`, `1200px`), not `global.css`. Regenerate it from `tokens.css` once tokens are approved. |
| `src/styles/tokens.css` | Single token file imported first by `global.css`, Storybook preview and the Open Design package | **Verified in Antigravity local trial, unpushed.** Absent at `36504ae`, where tokens live at the top of `global.css`. |

Mapping once approved: `tokens.css` is the only place token values are edited; `global.css`, Storybook and Open Design import it; the DTCG JSON and the sheet are generated or updated from it, never edited first.

## 3. Colour roles

Ratios recomputed by Claude. Where an earlier draft value differed, the recomputed value is shown.

### Core tokens

| Token | Value | Role | Key pairing | Ratio | Status |
|---|---|---|---|---|---|
| `--canvas` | `#f3f1ea` | Warm cream page ground | `--ink` text | 16.29:1 | Accepted; Verified at 36504ae |
| `--surface` | `#ffffff` | Cards, header, form panels | `--ink` text | 18.41:1 | Accepted; Verified at 36504ae |
| `--ink` | `#12141a` | Text, borders, primary button fill, dark sections | white text | 18.41:1 | Accepted; Verified at 36504ae |
| `--muted` | `#5a5f68` | Secondary prose and meta | on `--canvas` / `--surface` | 5.68:1 / 6.42:1 | Verified at 36504ae |
| `--line` | `#d9d6cc` | Card and divider borders | decorative only | n/a | Verified at 36504ae; not a control boundary |
| `--solar` | `#e8a01a` | Offset shadows, principle numbers, contact panel links | `--ink` on solar; solar on `--ink` | 8.31:1 | Accepted; Verified at 36504ae |
| `--solar-deep` | `#c97810` | Featured card border (local trial) | on `--canvas` / `--soft-solar` / white | 3.01:1 / 3.08:1 / 3.40:1 | Verified at 36504ae as a token; use as border Verified in Antigravity local trial, unpushed. Antigravity reports 3.12:1; passes 3:1 narrowly |
| `--clarity` | `#2f6fe0` | Accepted clarity blue: large accents and non text indicators | see below | see below | Accepted; Verified at 36504ae |
| `--clarity-text` | `#2459c4` | Deeper blue for small text on light grounds | see below | see below | **Provisional** |
| `--clarity-on-dark` | `#6ea2ff` | Small blue text on the dark section ground | on `--ink` / over `.16` amber glow | 7.25:1 / 5.55:1 | **Provisional**; Verified in Antigravity local trial, unpushed |
| `--soft-solar` | `#fff3d6` | Featured and `Pilot-ready` tint | `#754705` text | 7.16:1 | Verified at 36504ae |
| `--soft-clarity` | `#e8f0ff` | `Reusable` tint | `#244e9d` text | 6.92:1 | Verified at 36504ae |
| `--spectrum-teal`, `--coral` | `#2eb8b0`, `#ff7058` | Mark and ambient glow only | not for text | n/a | Accepted (spectrum reserved for the mark) |

Legacy aliases `--lime`, `--blue`, `--soft-blue` and `--soft-lime` map to the tokens above. `--lime` is amber, not green; new code should use the semantic names.

The `5.55:1` glow figure assumes the strongest amber glow stop (`rgba(232, 160, 26, .16)`) composited over `#12141a`, which gives `#342a1a`. On the same ground `--solar` gives `6.35:1`.

### Blue pairings

| Pairing | Ratio | Normal text (4.5:1) | Large text or UI (3:1) |
|---|---|---|---|
| `--clarity` on `--canvas` | 4.16:1 | Fail | Pass |
| `--clarity` on `--surface` | 4.70:1 | Pass | Pass |
| `--clarity` on `--ink` | 3.92:1 | **Fail** | Pass |
| `--clarity-text` on `--canvas` | 5.63:1 | Pass | Pass |
| `--clarity-text` on `--surface` | 6.36:1 | Pass | Pass |
| `--clarity-text` on proof block `#f5f6f3` | 5.86:1 | Pass | Pass |
| `--clarity-on-dark` on `--ink` | 7.25:1 | Pass | Pass |

### Where each blue is applied

| Selector | At 36504ae | Antigravity local trial, unpushed |
|---|---|---|
| `.eyebrow` on light grounds | `--clarity-text` | `--clarity-text` |
| `.asset-proof-links a` | `--clarity-text` | `--clarity-text` |
| `.brand-wordmark span` | `--clarity` (the one remaining serious axe finding on the home page) | `--clarity-text` |
| Body links (`.asset-how li`, `.audience-card b`, `.support-demo-aside a`, `.insight-prose a`) | `--clarity` | `--clarity-text` |
| `:focus-visible` outline | `--clarity` | `--clarity-text` |
| `.section-alt .eyebrow` | `--clarity`, **3.92:1, fails 1.4.3** | `--clarity-on-dark`, 7.25:1 |
| `.contact-details .eyebrow` | `--clarity-text` inherited from `.eyebrow` on the ink panel, **2.89:1, fails**. This regression came from the `36504ae` eyebrow change; it was 3.92:1 on `main` and also failed. | `--solar`, 8.31:1 |

### Dark eyebrow decision (Open, for Rajeev)

The `.section-alt` eyebrow is `.78rem` bold uppercase, which is normal text under WCAG, so `3.92:1` fails. Axe did not flag it because it skips text over the section's radial gradient background; Claude found it by calculation and Antigravity confirmed it.

| Option | Ratio | For | Against |
|---|---|---|---|
| `--clarity-on-dark: #6ea2ff` (local trial default) | 7.25:1 on ink; 5.55:1 over glow | Keeps blue as the eyebrow colour on every ground, so section labels read as one system | Adds a fourth blue token that needs brand approval |
| `--solar: #e8a01a` | 8.31:1 on ink; 6.35:1 over glow | No new token; matches `.contact-details .eyebrow` | Amber on dark eyebrows competes with principle numbers and the offset gesture, which spends the "one bold gesture" more widely |

Claude recommends `--clarity-on-dark` because it keeps the blue meaning of eyebrows consistent and leaves amber for the signature gesture. Either option passes; the choice is a brand decision.

### Prohibited pairings

* White text on `--solar` (2.22:1).
* `--solar` as the only boundary of a control on cream or white (1.96:1 and 2.22:1, below the 3:1 non text minimum).
* `--clarity` for normal weight text under 24px on `--canvas`, or on the dark section ground.
* Any spectrum token as text.

### Maturity status badges (Verified at 36504ae)

| Status | Text on fill | Ratio | Non colour cue |
|---|---|---|---|
| `Live proof` | `#285918` on `#e8f4df` | 7.28:1 (draft 7.39) | Visible label, filled marker |
| `Reusable` | `#244e9d` on `#e8f0ff` | 6.92:1 (draft 7.35) | Visible label, filled marker |
| `Pilot-ready` | `#754705` on `#fff3d6` | 7.16:1 (draft 7.21) | Visible label, filled marker |
| `Draft` | `#565b64` on `#f1f1ee` | 6.03:1 (draft 6.08) | Visible label, hollow marker, dashed card border, translucent card |

`StatusBadge.astro` renders the visible status text with a visually hidden "Maturity: " prefix, so screen readers announce the category as well as the value.

### Other contrast fixes

| Element | At 36504ae | Antigravity local trial, unpushed |
|---|---|---|
| `/principles` TOC numbers (`.principles-toc a span`) | `#8a9189` on cream, 2.86:1 by Claude's calculation (Antigravity reports 2.74:1), fails | `--muted`, 5.68:1 |
| Featured asset card border (`.asset-card.featured`) | `#99be5e`, 1.93:1 against its `--soft-solar` fill, below 3:1 | `--solar-deep`, 3.01:1 to 3.40:1 |

## 4. Typography, spacing and layout

Accepted in `SITE_FOUNDATION.md` (fonts); all values Verified at 36504ae.

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
| `--radius` | `1.15rem` for cards | Verified at 36504ae |
| Feature panels | `1.5rem` radius, `2px solid var(--ink)` border, `10px 10px 0 var(--solar)` offset (`.contact-panel`, `.support-form-card`, `.support-confirmation-card`, principles panel) | Verified at 36504ae |
| Pills | `999px` for buttons, status badges and topic chips | Verified at 36504ae |
| Functional depth | `--shadow: 0 18px 60px rgba(18, 20, 26, .1)` | Verified at 36504ae |
| Signature offset | `4px 4px 0 var(--solar)` on `.button` | Verified at 36504ae |

Motion: ambient and entrance keyframes (`brand-rise`, `brand-pulse`, `spanda-hum`, `principles-rise`) plus button transitions of `.18s`. Under `prefers-reduced-motion: reduce`, smooth scroll is turned off, all animation and transition durations collapse to `.01ms`, and named hero and section animations are set to `none`. Colour and focus changes remain immediate. Verified at 36504ae; not checked in a browser by Claude.

## 6. Interaction, focus and keyboard

| Rule | At 36504ae | Antigravity local trial, unpushed | Status |
|---|---|---|---|
| Focus ring | `3px solid var(--clarity)`, `outline-offset: 4px`; as a non text indicator meets 3:1 on cream (4.16), white (4.70) and ink (3.92) | `--clarity-text` on light grounds (5.63 to 6.36) | Light ground change **Provisional**, tied to `--clarity-text` sign off |
| Focus ring on dark grounds | `--clarity` (3.92:1) | `--solar` on `.section-alt` and `.contact-details` (8.31:1), as reported in the source draft | **Provisional** |
| Primary button | Ink fill, white text, `min-height: 48px`, amber `4px` offset; hover `translate(2px, 2px)` with `2px` offset | Unchanged | Verified at 36504ae |
| Primary pressed state | No `:active` rule | `:active` `translate(4px, 4px)`, `0` offset | Verified in Antigravity local trial, unpushed |
| Secondary button | Transparent, ink text, no resting offset. **Defect:** it also matches `.button:hover`, so hover shows a `2px` solar shadow | Ink wash hover and active with `box-shadow: none` | Verified in Antigravity local trial, unpushed |
| Button row spacing | No `.button-row` gap rule | `.button-row` gap `13.6px` | Verified in Antigravity local trial, unpushed |
| Skip link | Fixed, ink fill, slides in on focus, targets `<main id="main">` | Unchanged | Verified at 36504ae |
| Skip target focus | `<main id="main">` without `tabindex` | `<main id="main" tabindex="-1">` | Verified in Antigravity local trial, unpushed |
| Mobile menu | `aria-expanded`, `aria-controls="site-navigation"`; Escape closes and returns focus (tested in `tests/e2e/components.spec.ts`) | Unchanged | Verified at 36504ae |
| Menu button target size | No minimum size rule | `min-height` and `min-width: 44px`; `44.39px` measured at `390px` | Verified in Antigravity local trial, unpushed |

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

Additional files reported on `antigravity/astro-framework-trial` (Verified in Antigravity local trial, unpushed; absent at `36504ae`):

| File | Purpose |
|---|---|
| `src/styles/tokens.css` | Single token source |
| `ActionLink.astro` | Shared primary and secondary action link |
| `PageHero.astro` | Shared page hero |
| `src/stories/*.stories.ts`, `.storybook/preview.ts` | Native `.astro` stories with `@storybook-astro/framework@1.18.0` |
| `open-design-system/` | Open Design `v0.27.2` package and static HTML specimen |

Repository guidance says Storybook is optional and markup should not be duplicated in another framework only to create stories. The local trial uses native `.astro` stories, which renders the real components rather than copies; Rajeev should still confirm that Storybook is worth keeping.

Tests: `tests/e2e/components.spec.ts` (six Playwright tests) at `36504ae`.

## 9. Decisions

| Decision | Status | Owner |
|---|---|---|
| Warm light ground, ink structure, solar proof accent, clarity blue, spectrum reserved for the mark | Accepted (`SITE_FOUNDATION.md`) | Rajeev |
| Sora display and Source Sans 3 body | Accepted | Rajeev |
| `--clarity-text: #2459c4` for small text and focus on light grounds | **Provisional** | Rajeev |
| Dark eyebrow: `--clarity-on-dark: #6ea2ff` (recommended) or `--solar` | **Open**; local trial uses `#6ea2ff` provisionally | Rajeev |
| Solar focus ring and solar eyebrow inside `.contact-details` | **Provisional** | Rajeev |
| Primary pressed state, secondary ink wash, button row gap, 44px menu target, `tabindex="-1"` on main | Verified in Antigravity local trial, unpushed; needs push and review | Rajeev |
| TOC numbers to `--muted`; featured border to `--solar-deep` | Verified in Antigravity local trial, unpushed | Rajeev |
| Container `1180px` versus sheet and Drive JSON `1200px` | **Open**; `1180px` kept | Rajeev |
| Sheet and Drive JSON colours (`#598BE2` and others) versus code | **Open**; regenerate both from `tokens.css` after approval | Rajeev |
| Keep `tokens.css`, native Storybook and Open Design package | **Open** | Rajeev |
| Register this document in `DOCUMENTATION_ROUTER.md` | **Open**; needs owner approval | Rajeev |

## Evidence and limits

### Checked by Claude on 2026-11-24

* Every claim labelled Verified at 36504ae was read from the code at that commit.
* All contrast ratios in this document were recomputed with the WCAG relative luminance formula, including those reported by Antigravity. They agree except the TOC (2.86 versus 2.74) and `--solar-deep` (3.01 to 3.40 versus 3.12); both differences depend on the assumed ground.
* Earlier the same day at `36504ae`: `pnpm build` with validators passed; `tests/e2e/components.spec.ts` passed 6 of 6 (failed 6 of 6 on `main`); the full end to end suite passed 7 of 7 on the dev server; home page axe serious findings fell from 10 to 1.

### Reported by Antigravity, local trial, macOS Chrome 158, 2026-11-24 (not reproduced by Claude)

* `pnpm build`: 25 pages plus validators.
* Storybook: 21 of 21 native `.astro` stories.
* Open Design `v0.27.2` static specimen: 0 axe violations at `390px` and `1280px`.
* Playwright: 10 of 10 with axe and local `@chromatic-com/playwright` archives; 0 violations and 0 horizontal overflow across 8 routes from `320px` to `1440px`.
* Three way comparison against live https://aispanda.com, `main` and the trial.
* Axe passes do not cover text over the dark section gradient; the dark eyebrow failure was found by calculation.

### Not done

* Cloud Chromatic (`chromatic --playwright`): no `CHROMATIC_PROJECT_TOKEN`.
* `vela` login.
* Push of `antigravity/astro-framework-trial`, and any merge or deploy.
* Claude could not load the live site from its shell.
* Human visual review, VoiceOver, browser zoom and real device testing.
* Brand approval of any provisional value.
