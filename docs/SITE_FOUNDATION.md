# AIspanda Site Foundation

## Purpose

AIspanda is a public proof and learning platform for practical AI strategy, engineering and delivery. It builds credibility through concise thinking, reusable assets and live demonstrations rather than unsupported claims.

## Audiences

- Business decision-makers: value, risk and the smallest credible next step.
- Technology leaders: architecture, governance, cost, scalability and evidence.
- Builders: reusable patterns, tools, prompts, code and demonstrations.

One site serves all three through progressive depth. Business outcomes appear first; technical evidence and sources remain available without dominating every page.

## Stages

| Stage | Scope |
|---|---|
| Launch | Home, insights, engineering principles, reusable-asset catalogue, live Data Model Explorer, About, Contact and Privacy |
| Next | Résumé, skills, selected case studies and expanded search/collections |
| Later | Moderated discussions, contributions, accounts, portal and groups/chat after demand and operating ownership exist |

## Brand direction

New identity for a **personal AI thought-leadership blog** (not a firm; nothing for sale on these surfaces). Public story: source sun + skill/judgment; colourful vibratory network. Avoid corporate theatre, novelty mascot, and any religious/Tantric iconography on public pages.

### Launch identity contract

| Element | Launch direction | Status |
|---|---|---|
| Promise | Help people keep agency in the AI age through clear writing, reusable systems and inspectable proof | Accepted |
| Personality | Intelligent, candid, calm urgency; avoid hype, firm theatre, novelty mascot | Accepted (voice do/don’t may still DEFER) |
| Voice | Business meaning first; evidence or honest status; personal “I/this blog” not “we advise clients” | Accepted for launch posture |
| Logo | Sun/disc source + spectrum ripple mark; wordmark **AI Spanda** (two words); mono + favicon variants | Accepted — rasters in `public/brand/`; SVG recreation still open |
| Colours | Warm light ground + ink structure; **solar** proof accent + **clarity** blue; spectrum reserved for the mark | Accepted for UI pass |
| Typography | Sora (display) + Source Sans 3 (body) | Accepted for UI pass |
| Imagery | Hero/OG abstract source+vibration; no stock robots or sacred symbols | Accepted — `public/social/hero.png`, `og.png` |
| Social image | `public/social/og.png` | Accepted draft in use |
| Rights/provenance | Project-owned generated rasters + site code; no third-party logos | Recorded |

## Architecture

- Static-first Astro site: fast initial HTML, durable URLs and minimal client JavaScript.
- One typed content/config source feeds repeated navigation, assets, insights and principles.
- Live tools remain modular assets and may be mounted beneath `/labs/` or deployed independently.
- The Data Model Explorer remains owned by reusable asset RA-001. AIspanda tracks only its verified public build at `/labs/data-model-explorer/`, refreshed through the registered sync script; it does not fork the viewer source.
- Cloud Run serves the generated site from a small port-8080 container, request-based, with minimum instances zero.
- Deployment consumes the central gated Deployment Automation toolkit; this repository owns only its project profile and build contract.

## Accepted decisions

| ID | Decision | Reason |
|---|---|---|
| D01 | New AIspanda identity and brand | The site represents a new long-term professional direction. |
| D02 | Serve leaders and builders together | Progressive depth lets one proof support business and technical evaluation. |
| D03 | Launch with light insights, principles, assets and live ERD proof | Demonstrates thinking and implementation before adding résumé or community scope. |
| D04 | Astro static-first | Content-led launch gets fast HTML, low runtime complexity and future interactive islands. |
| D05 | Cloud Run with scale-to-zero policy | Reuses existing Google deployment experience while avoiding an always-on compute floor. |

## Current boundaries

No comments, accounts, uploads, payments, analytics, custom forms, newsletter, database or application AI calls in the first release. Contact uses ordinary email with a warning not to send confidential information.

Public source and generated output must not contain prohibited source-project or third-party names, or copied identity/content. The production build enforces this boundary automatically without storing those names in readable repository text.

## Release checks still pending

- Live visual ACCEPT of the UI pass (home first) by Rajeev.
- Compress public brand/social rasters; recreate production mark as true SVG geometry.
- Exact Google Cloud project ID, region, Artifact Registry repository and service name remain project-owned deployment inputs.
- No local container engine is installed; the approved Google Cloud build must verify the container before deployment.
- Deployment, DNS, Git commit and Git push still require explicit authorization.
