# State Contract — `catalogue-card`

> Each declared state is produced by a synthetic fixture and real production component. This contract describes the component boundary only; it does not claim to verify data retrieval, account behavior, or release readiness.

## Surface purpose

**User outcome:** A person can understand a record’s purpose, maturity, proof, and next action before choosing whether to open it.

**Production implementation:** `src/components/AssetCard.astro`

**Local fixture source:** `src/ui-evidence/catalogue-card.fixtures.ts`

**Access boundary:** The first adapter uses synthetic public fixture inputs only. It exposes no account, live-data, or restricted-content behavior.

## Data and lifecycle states

| State ID | Trigger / fixture input | Visible hierarchy and message | Available action / recovery | Focus and announcement | Evidence |
|---|---|---|---|---|---|
| `catalogue-card-populated` | `populatedAsset` | Type, textual maturity, name, summary, outcome, proof, topics, and record action | Open a fictional record link | Native link focus remains visible through global styles | Render review |
| `catalogue-card-featured` | `featuredAsset`, `featured: true` | Base hierarchy is retained; emphasis adds no hidden meaning | Open a fictional record link | Same link focus behavior as populated | Render and visual review |
| `catalogue-card-draft` | `draftAsset` | Textual “Draft” maturity remains visible alongside the distinct visual treatment | Open a fictional record link | Same link focus behavior as populated | Render, visual, and manual accessibility review |

## Interaction states

| Element / action | Default | Keyboard / pointer action | Result | Focus outcome | Fixture or test |
|---|---|---|---|---|---|
| Proof links | Visible descriptive text | Tab then Enter | Opens declared local destination | Native anchor focus remains visible | Manual keyboard review |
| Record link | Visible descriptive text with arrow decorative only | Tab then Enter | Opens declared local destination | Native anchor focus remains visible | Manual keyboard review |

## Environment and resilience states

| Condition | Expected transformation | Information or function preserved | Evidence |
|---|---|---|---|
| Compact width | Grid composition moves to one column where necessary | Entire card and next action remain available | Small-width catalog review |
| Long text | Existing wrapping and flexible layout preserve visible text | Essential content is not supplied only in a truncated form | Synthetic long-content fixture in a later iteration |
| Text scaling / reflow | Existing global responsive rules retain readable structure | Focusable links remain reachable | Manual critical-path review |
| Theme / contrast mode | Current production theme applies | Status remains textual and not color-only | Manual review; no conformance claim |
| Reduced motion | Existing global rule reduces nonessential motion | Card meaning does not depend on motion | Manual review |

## Exclusions and limitations

| Item | Reason / required separate evidence |
|---|---|
| Empty or no-results state | Belongs to the containing catalogue surface, not a standalone card |
| Restricted-content state | Requires an explicit local access boundary and controlled fixture in a later packet |
| Service error or offline state | Requires a data-boundary and whole-flow contract |
| Authorization, privacy, security, data integrity, field performance | Require separate implementation and operational evidence |

## Completion check

- [x] Each material first-iteration state has a stable ID, fixture input, visible result, next action, and evidence.
- [x] Status meaning is available in text and structure, not only color.
- [x] Material link behavior has an explicit keyboard and focus review.
- [ ] Long-content and restricted-state fixtures are considered for the next bounded expansion after the pilot decision.
- [x] The evidence claim is limited to real-component rendering and declared local review.
