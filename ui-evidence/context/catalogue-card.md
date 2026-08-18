# UI Context Packet — `ASSET-QUALITY-001: Make maturity and evidence understandable at a glance`

> This is the first thin adapter for the master Interface State Evidence System. It renders a real production card with synthetic inputs. It is a small evidence slice, not a redesign of the catalogue or a claim that broader journeys are complete.

## Concept in plain language

A catalogue card helps a person decide whether to open a record. It must make the item’s purpose, maturity, proof, topics, and next action understandable without asking the person to infer meaning from decoration alone.

This packet teaches the difference between a component **state** and a visual **style**. A maturity state changes what needs to be communicated: a draft must not look as established as a reusable method, and a highlighted item must remain equally understandable rather than becoming a decorative exception.

## Scope and non-goals

| In scope | Explicitly out of scope |
|---|---|
| Real `AssetCard.astro` rendering with synthetic populated, featured, and draft fixtures | Data retrieval, filtering, authorization enforcement, content authoring, release publication, or a full catalogue redesign |

## Outcome and evidence

| Item | Record |
|---|---|
| User / role | A person comparing reusable records before choosing one to explore |
| Situation / trigger | The card appears in a local catalogue view or isolated component catalog |
| Observable outcome | The person can distinguish purpose, maturity, proof, topics, and next action |
| Success signal | Each fixture renders the same information hierarchy with its maturity clearly communicated |
| Guardrail | Only synthetic data is used; status meaning is not conveyed by color alone |
| Owner / review point | Interface steward; review when a new status or card field is proposed |

## Canonical references

| Concern | Exact local source | Use it for |
|---|---|---|
| Production implementation | `src/components/AssetCard.astro` | Component API and rendered behavior |
| Local styles / theme | `src/styles/global.css` | Shared visual roles, compact behavior, and reduced-motion rules |
| Fixture source | `src/ui-evidence/catalogue-card.fixtures.ts` | Deterministic synthetic inputs |
| Catalog configuration | `.storybook/main.ts` and `.storybook/preview.ts` | Isolated rendering configuration |
| State contract | `ui-evidence/contracts/catalogue-card.md` | Material states and acceptance evidence |
| Execution record | `AI-44` | Scope, implementation evidence, and follow-up |
| Decision record | Existing review queue, first bounded-pilot decision | Approval boundary for later expansion |

## Role and access boundary

| Capability | Allowed state | Restricted state | Visible explanation or next action |
|---|---|---|---|
| Read the card’s public synthetic fixture | Local interface review | No live content or account information is loaded | Open the fictional record or evidence link only |

## State selection

| State ID | Why it is material | Fixture key | Evidence required |
|---|---|---|---|
| `catalogue-card-populated` | Establishes the base information hierarchy | `populatedAsset` | Render review |
| `catalogue-card-featured` | Tests emphasis without losing required information | `featuredAsset` plus `featured: true` | Render and visual review |
| `catalogue-card-draft` | Tests clear, non-color-only communication of lower maturity | `draftAsset` | Render, visual, and manual accessibility review |

## Acceptance evidence

| Claim | Minimum evidence | Local command or review | Result location |
|---|---|---|---|
| Real component receives deterministic inputs | Catalog build | `pnpm run storybook:build` | Local build output |
| Three material maturity states render | Story fixtures and reviewer check | Inspect each named story | Catalog sidebar and review note |
| Status meaning remains textual | Manual review of the badge text and hierarchy | Keyboard and visual check | Review note |
| Existing compact behavior is not silently changed | Small and wide viewport review | Catalog viewport controls or browser review | Review note |

## Risks, assumptions, and decisions

| Type | Item | Owner / next action |
|---|---|---|
| Assumption | The selected Astro catalog adapter is compatible with the locked project runtime | Verify in the primary development environment before promotion |
| Limitation | Isolated rendering does not prove service behavior, authorization, privacy, security, or field performance | Keep these claims out of this adapter’s evidence |
| Decision | First bounded-pilot journey remains the expansion gate | Answer in the existing decision queue before creating broader journey artifacts |

## Learning check

A reviewer should be able to explain why populated, featured, and draft are distinct communication states; where the real production component lives; why fixtures are synthetic; and which claims the isolated adapter does and does not prove.
