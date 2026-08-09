---
title: "Own the Shared Track. Make AI Providers Compete for the Work."
eyebrow: "Incentive design"
summary: "Access to advanced AI is splitting opportunity. Students, startups, campuses, and countries across the Global South that cannot reach strong tools will not only move slower. They will live under rules written elsewhere, much as early COVID vaccine supply clustered with richer buyers when push came to shove. That is an equity problem, and for dependent nations a sovereignty risk. This essay argues for an independent or public shared track so providers compete for the work on results, not brand loyalty."
readTime: "18 min read"
---

Models you can download and run yourself help, but that is not freedom by itself. Without thrift and a real way out, independence becomes a money fire. Closed subscriptions keep you renting thinking power on someone else’s terms. On a modest home machine (under USD 1,000) I have been trying open weights against paid APIs on my own tasks. That is personal experimentation, not proof of a national design; it only means this essay is not written from the outside looking in.

Private operators already sell the shared serving pattern. [Modal’s shared endpoint for a large open weight model](https://modal.com/blog/kimi-k3-by-moonshot-now-available-on-modal) is a plain example: they put the model on shared machines, let many customers use it, and bill like a normal usage API (including about $30 per month in free starter credit). You do not rent a lonely hall and do all the ops yourself. You pay for use. Other commercial hosts do the same broad pattern: open weights on shared capacity, metered like chat APIs.

What those private products do **not** automatically give you is a public or independent buyer club with exit and mission pricing. That is the gap this essay cares about.

**Own the shared track** does not mean one person, or even one university, buys the whole machine. Most students, startups, and single campuses are too small alone. It means different kinds of buyers pooling together (universities, public agencies, and paying firms) behind an **independent or public switchboard**: a shared front door that sends each job to a good enough path, pools purchasing power, and lets you leave when a better option wins on evidence. Providers then compete for that work. Brand and flag loyalty stop being the trap.

That design is what this essay calls a **Competitive Public AI Switchboard**. It borrows the private lesson (shared serving, pay for use, open weights welcome) and asks public and consortium buyers to own the track so the market stays thick. Capitalist friendly. Competition first. Thought leadership and small experiments on limited means, not a program I can fund. If institutions pick it up, good.

Plain terms are in **Terminology** at the end. Hard terms get one plain gloss on first use.

---

## When self-run open models burn money fast

An **open weight model** is an AI system you can download and run yourself, instead of only renting answers from a company’s locked chat product. If **you** self host a large one (run it on machines you rent or own, instead of using a company’s chat box) without the cost saving habits below, a small credit balance can vanish in hours.

That is an **operations** failure on the self hosted path. Three thrift habits are missing (think kitchen discipline: share the oven, use a lighter recipe when it still tastes fine, turn the burners off at night). They matter for a lone developer, for a campus or agency group, and for a **public switchboard**.

**Warm** means the model is already loaded into fast memory and ready to answer. Loading a large model from disk takes time and money. A **cold** start pays that cost again. Big closed chat products keep models warm and shared across millions of users in the background. When you self host without care, you often pay to load, then pay again while machines sit idle. The habits below copy the thrifty part of that private playbook for an open or public path.

In this essay, a **Public Smart Router** (also called a public router) is a shared, brand agnostic front door: not owned by one lab, one cloud, or one region’s favorite vendor. It holds a menu of routes: open weight models, paid company APIs, local or remote, cheap or heavy. For each request it chooses a path using published benchmarks and clear rules, or your own logic, to optimize what you care about for that job: quality, cost, speed, or a mix. Think of a skilled head waiter who knows the whole kitchen, not a waiter who only sells one chef’s brand. A **public switchboard** is that router plus pooled buyers and pricing (who gets capped free use, who pays).

**Why routing is necessary:** one model cannot win every job. A practice quiz, a translation, a summarization, and a hard legal draft need different quality, speed, and cost. Without a router, each campus app hard-wires one vendor, so money burns on overkill models, weak models fail quietly, and exit dies. Routing sends each request to a good enough path, keeps score, and lets you switch when a better measured route appears. The router must also bake the three habits in from day one, or the pool burns money at larger scale.

| Habit | In plain words | Who | The insight |
| --- | --- | --- | --- |
| **Share the oven** (dynamic batching) | Many people use one already warm (already loaded) model together, instead of each person paying to load their own copy. | Shared groups and the public router (solo users gain little until traffic rises) | Everyday chat is where money dies if every small question wakes a cold machine. |
| **Lighter recipe when good enough** (quantization) | Keep a smaller copy of the model for ordinary work; keep a heavier copy only when quality truly needs it. | Solo, groups, and the public router | Sharing does not cancel the bill. A lighter copy lets more people ride the same rented chips. |
| **Burners off when quiet** (scale to zero) | If you rent GPUs that bill while “on,” shut them when idle and wake when needed. Not about home PCs or flat chat seats. If usage is steady and heavy, reserved always-on capacity can beat stop-start; that is a utilization choice. | Mostly shared campus/public pools and metered cloud rent | Don’t pay overnight rent for an empty kitchen. Spiky load → turn off. Steady full load → keeping the stove warm (or a longer commit) can win. |

Two ideas, stated simply. First, those thrift habits stop waste, so a shared router can cost less than running big models yourself without discipline, when the habits actually run. Second, because capacity is rented with the right to leave, you are not locked in: next year you can switch data center, provider, or model route when a better measured deal appears. A single closed landlord and a lonely self hosted setup both struggle to match that mix. The router must require the thrift habits so public money does not buy idle burn.

This is different from a closed product subscription such as a fixed monthly chat plan. There the provider already keeps models warm and shared; your cost is largely a **constant rented seat with usage limits**, not classic pay as you go on machines you operate. The subscription can still feel expensive or capped. It does not prove the same cost failure as burning cloud credits when you run models yourself without those habits.

If that self hosted cost curve is real for one developer, a society that treats intelligence access as a luxury drifts toward **AI feudalism**: a few landlords of compute and closed APIs, everyone else renting cognition on someone else’s terms.

The policy and business job is to **build alternatives that raise competition** so markets stay thick and exits stay real. Private capital is welcome when it builds capacity, serves quality, and competes in the open.

---

## Five public moves (and what they actually do)

When you type a question into a chat box, the answer is not sitting inside your laptop. It is delivered through a short stack. Picture a kitchen order: you speak to the waiter, the kitchen cooks, the building has the stoves, and the power company supplies the heat.

1. **Chips (the stoves):** special computer chips that do the heavy AI work fast. Without them, large models crawl.
2. **Data centers (the kitchen building):** warehouses full of those chips, plus power, cooling, and network pipes. Someone owns or rents that hall.
3. **Models (the recipes):** the trained model files (often called **weights**) that turn your words into answers. Some stay locked behind a company door (you only rent answers). Others are downloadable open weights (you can run them yourself or through a shared host).
4. **Apps (the waiter and menu):** the chat screen, campus tool, or company product you actually touch.

Your request goes app → model → chips in a data center → answer back. The public moves below act on different layers of that path. Several ideas that look like separate programs are really **one move with modes**:

**A. Competitive Public AI Switchboard** · *Models + access*  
The shared ordering desk: one front door routes each task (open models by default; private only when they win a fair bake off), pools buyers (universities, agencies, paying firms as examples), and prices access with caps then paid use.

**B. Capacity with exit** · *Cloud*  
Rent the kitchen; do not insist on owning the building. Default: hire and flip (rent from whoever is best this year, with the right to leave). When a new hall is truly needed, let private firms build and run it. The public can help without taking the keys: promise to buy a block of capacity so the project can raise money, put public money beside private money, ease land and power and permits, or run a fair contest for who supplies the pool. Avoid a government owned AI factory as the default.

**C. Public money: creation first** · *Money on models / firms*  
Put public money mainly into building new capability: help fund teams that invent and prove better tools, and only pay when they hit clear checkpoints. Helping small firms with a share of their cloud bill (as in [Canada’s Access Fund](https://ised-isde.canada.ca/site/ised/en/canadian-sovereign-ai-compute-strategy/ai-compute-access-fund)) is useful relief. It should not be the whole plan, or you pay forever for usage without growing an open ecosystem.

**D. Open stack commons** · *Models + commons*  
Two plain jobs. First, when it matters who writes the shared base recipe, help fund group training of open foundation models ([Tapestry](https://thealliance.ai/projects/tapestry) style). Second, pay the people who keep open tools working ([Sovereign Tech Fund](https://www.sprind.org/en/impulses/projects/sovereign-tech-fund) style). Otherwise “open” looks free while only middlemen get paid and the tools quietly decay.

**E. Fair competition rules for the pipe** · *Cloud / platforms*  
If one landlord owns the only road to the kitchen, rivals still get fair access. Secondary to building a real public offer (A–D).

**Top combination for most starters:** **A + B + C**, with **D** for surplus and upstream hygiene, and **E** only as a narrow backstop.

### When is a shared router on rented GPUs actually cheaper?

**No.** That cheaper claim is only about Moves **A + B** (a shared front door on rented machines you can leave). It is **not** automatic for every public program.

**True when three practical conditions hold** (otherwise you can still waste money at larger scale):

1. **You run the machines efficiently.** Use the three thrift habits in the table above. Without that, open AI still burns cash.
2. **You can actually leave a bad deal.** Exit rights are written into contracts and tested, not only promised in a slide deck. Without that, “rent” becomes a soft marriage to one landlord.
3. **Most of the rented time is busy.** If you rent a hall for a concert and half the nights sit empty, you still pay the full rent. Same with GPUs: idle machines still bill. A half-used pool is not “cheaper” just because the sticker price per hour looks good.

A shared router and a rental contract do not automatically cut the bill. Someone still has to run the machines well and leave bad deals when better ones appear.

| Move | Relation to “router + rent can be cheaper” | Role in this design |
| --- | --- | --- |
| **A. Switchboard** | Makes cheaper and fairer access possible when thrift, exit, and utilization hold; free allowance is a **pricing feature**, not a separate entitlement. | The main move. Strong examples: universities, agencies; consulting pays. |
| **B. Capacity with exit** | **Core of the cost claim.** Rent from vendors who compete; move when a better price, SLA (uptime and support promises), or measured route wins. Savings depend on real exit, not slide-deck exit. | Underpins the umbrellas. |
| **C. Public money: creation first** | Creation match is not GPU rent math; cost share lightens bills but can hide waste if uncapped. | Fund router tooling and open builders; use bill share as relief with milestones. |
| **D. Open stack commons** | Pretraining is a different bill than chat serving; maintainer pay prevents false cheapness. | When foundation ownership and tool health matter. |
| **E. Fair pipe rules** | Does not make inference (day-to-day answering of prompts) cheaper. Keeps the cheaper path **contestable**. | Narrow: open access, no self dealing. Lead with A–D. |

**Option E in one concrete picture:** Suppose the consortium rents GPUs and runs the switchboard. A dominant cloud landlord could still prefer its own closed API on that pipe and starve rival open serving. **Fair competition rules** say rivals get comparable access. That expands the market. It does not ban private models or replace rivalry with a compliance maze.

### How the public gets capacity without owning the factory

Left to the public alone as builder and owner, big construction often bloats and invites capture. Two modes (own the dinner service, not necessarily the real estate):

1. **Hire and flip (default):** rent from whoever runs the best kitchen this year; leave when a better price, SLA, or measured route wins.
2. **Private build, public enable (when new capacity is needed):** private players build and run; the public helps without taking the keys (promise to buy capacity, put money beside private money, ease land and power and permits, or run a fair supply contest).

Design tests: **exit possible**, **open access if public money entered**, **pay for uptime and outcomes**, not for a ribbon cutting. A fuller toolkit of ten enablement models sits in the **Appendix** at the end.

---

## The public smart router

### What it is

Usually run by a public body or consortium. For each job it picks from the menu above (open or paid, cheap or heavy) using measured results and rules. Without that control layer, a shared pool overpays for one default or fails on hard tasks. Buyers and pricing around it make the wider **switchboard**.

### Why builders and buyers care

The primary move is **create a strong public alternative and a bulk buyer** so private providers compete for that traffic on price and quality. Volume is leverage: a serious offtaker, not a permission office. Private companies can use the same router so it does not become a sleepy internal tool.

### What “learning from use” should and should not mean

**Should mean:** the router improves using **evaluations** (automated tests of quality and safety on representative tasks), cost telemetry, and explicit feedback.

**Must not mean:** silently reading all citizen or student prompts to “learn.” Privacy design is part of the product: tenant isolation, minimal retention, optional campus edge routing for sensitive workloads.

### Measure routes before you lock in a vendor

Try real work on more than one path before marrying a vendor. Prefer open weights when they are good enough; use private routes when they win on evidence. Publish the evals; do not trust a slide deck.

### Free allowance as part of the product, not a separate program

Private serverless platforms already use this pattern. Some, for example, currently offer about **$30 per month** in free compute credits on a starter plan so builders can try the platform before they pay more. That free tier only works because it sits **on top of** routing, scale to zero, and billing controls. Untethered “everyone gets free AI” is not the product.

A Public Smart Router can offer the same shape with a different purpose:

| Private free credits (serverless style) | Public router free allowance |
| --- | --- |
| Growth and trial for paying customers | Access for learning, research, and civic tools |
| Platform chooses cheapest reliable route for itself | Public chooses **good enough open by default**, private by merit |
| Cap + pay for more | Cap + pay for more; identity and acceptable use already exist on campus |
| Sustainability = company unit economics | Sustainability = utilization, tier discipline, exit, and upstream pay |

So free credits are **how the switchboard prices access**: capped free use on measured routes, then paid use. Where to start, and how wide to go later, is covered under shared buying groups below.

### Three tests a router must pass

1. **Exit test:** switch primary open model or data center in a set time (for example about 30 days as a design target) without rewriting every campus app.
2. **Bargain test:** aim to show a documented discount versus walk up API rates when pooled volume is real. Volume often helps; it is not guaranteed.
3. **Eval test:** routing changes require published evaluation results, not a vendor slide deck.

---

## Shared buying groups (campuses, agencies, paying firms)

### What it is

An **umbrella** is one buyer, one set of contracts, one router front door for a dense group that already shares identity and mission (like one cafeteria contract for a school system, not a separate kitchen in every classroom). Rent capacity from vendors who compete for the contract (Move B). Serve at least two open weight stacks through the router (Move A).

Do **not** put every sector in one subsidy pot. Keep separate umbrellas so money and rules match the mission. The list below is **examples**, not a required national sequence:

| Umbrella | Who | Role in the design | Free / subsidy? |
| --- | --- | --- | --- |
| **1. University / research (strong starting example)** | Campuses, public labs | Prove utilization, exit, evals, and tier discipline | Yes: students and research, capped |
| **2. State / federal agencies (another example)** | Ministries, departments, regulated public services | Anchor offtake for civic workloads; stricter security and retention zones | Mission funded, not “citizen free AI” by default |
| **3. Consulting / industry (offtaker, not owner of the subsidy)** | Firms that sell AI work or run heavy internal use | Buy capacity at near or above cost; add volume and surplus | No public free tier; they pay |

Consulting already appears as the **Industry / paid** tier. That is intentional: firms can form a private buying club without draining student budgets. State and federal need their own umbrella because procurement and data rules differ from campus life.

### Who pays what on a campus


| Tier            | Who                               | Price idea                            | Why                                   |
| --------------- | --------------------------------- | ------------------------------------- | ------------------------------------- |
| Student         | Enrolled students                 | Free or deep discount, capped credits | Public education subsidy              |
| Research        | Labs / faculty grants             | Grant funded or discounted            | Science is a public good with budgets |
| Industry / paid | Companies, consulting, heavy labs | Near or above cost                    | Cross subsidy and surplus             |


Analogy: **university libraries already work this way**. Students do not pay full commercial database rates. The institution aggregates demand. Publishers still sell. Sustainability depends on budgets and utilization.

Agency umbrellas can reuse the same router and capacity market with different tiers (for example: internal staff tools, citizen facing services with hard caps, and paid inter agency chargeback).

### Is it sustainable?

Yes when four conditions hold:

1. **Utilization.** Idle GPUs are death. Use the three thrift habits above so you pay for work, not idle machines.
2. **Tier discipline.** Industry must not drain the student subsidy pool. Agency workloads must not hide under education budgets.
3. **Exit clauses.** Hire and flip must be contractual, then tested.
4. **Upstream pay.** Surplus funds builders and maintainers (Move D), not only the landlord and a system integrator.

### Why start with universities

Students and researchers already have institutional identity, acceptable use policies, and a mission (learning and discovery). Start the free allowance there. Widen to a broader public only after utilization and abuse controls are proven. Add a state/federal umbrella when procurement and security zones are ready. The exact brand matters less than **umbrella buyer, tiered pricing, and router**.

---

## Pay for outcomes and innovation (not only for GPU hours)

[Canada’s AI Compute Access Fund](https://ised-isde.canada.ca/site/ised/en/canadian-sovereign-ai-compute-strategy/ai-compute-access-fund) (Move C, relief mode), part of the [Canadian Sovereign AI Compute Strategy](https://ised-isde.canada.ca/site/ised/en/canadian-sovereign-ai-compute-strategy), helps SMEs by covering a share of eligible cloud costs. That fights a real pain: compute is expensive.

Israel’s long running playbook (through the [Israel Innovation Authority](https://innovationisrael.org.il/en/), including [Yozma](https://innovationisrael.org.il/en/calls_for_proposal/yozma-2-0-fund/) style match capital and [MAGNET](https://innovationisrael.org.il/en/programs/applied-research-consortiums/) style industry university consortia) emphasizes something slightly different: **assist competition by co funding creation**.


| Pattern                                          | Plain meaning                                                                                         | AI compute use                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Matching / co investment (Yozma style)**       | State puts money beside private investors so more capital reaches startups; sometimes shares downside | Match private money into open serving companies, eval startups, router tooling |
| **R&D grants with milestones**                   | Pay companies to reach technical proof, not to forever rent GPUs                                      | Fund productizing open models for local languages, domains, safety             |
| **Industry university consortia (MAGNET style)** | Firms and labs co develop pre competitive technology with grant support                               | Natural partner to a university compute umbrella                               |


**Adverse selection** is the free buffet problem: unlimited free plates attract waste. Matching private effort attracts people with skin in the game.

So: cost share consumption when needed. **Prefer matching creation** when you want a durable open ecosystem.

---

## How the pieces fit together

```text
Demand umbrellas (same router market, separate money pots; examples, not a fixed order)
  ├─ University / research  ←── strong starting example; free/capped tiers
  ├─ State / federal        ←── another example; mission funded; stricter zones
  └─ Consulting / industry  ←── paying offtakers (volume, not subsidy)
        │  buy with exit clauses
        ▼
Rented GPUs (vendors compete; you can leave)  ←── hire and flip
        │
        ▼
Public Smart Router  ←── open weights default; private routes by merit
        │
   tiered pricing per umbrella
        │
        ▼
Surplus + matched funds  ←── Israel style incentives
        │
        ▼
Upstream builders & maintainers  ←── not only middlemen
```

This assembly is the article’s **scenario blueprint** (a proposed design). It is not a claim that any one country already runs the whole machine. Observed cousins exist in pieces: public AI as a competitive public option beside private markets ([VPA / Ash Center line of work](https://cdn.vanderbilt.edu/vu-URL/wp-content/uploads/sites/412/2024/09/27201409/VPA-Paper-National-Security-Case-for-AI.pdf)), Canada’s capacity strategy, training consortia, Sovereign Tech Fund maintainer pay, research compute pools.

---

## Risks

1. **Router as honey pot:** central visibility of prompts. Design privacy first.
2. **Soft lock in:** even with open weights, habits and workflows stick. Run exit drills.
3. **Capture:** large campuses or consultancies dominate the consortium. Publish allocation rules.
4. **Metric theatre:** optimizing tokens while learning quality falls. Tie routing to evals.
5. **Algorithmic bureaucracy:** do not use the switchboard to silently judge people’s rights. Keep it for tools and throughput.

---

## What to do next

This essay is **thought leadership**, not a program I can staff or fund. My lane is writing, sharing, and small experiments on limited means. If someone with a campus, agency, or buying club runs with the idea tomorrow, that would be a win. Until then, use it as a clearer way to argue and notice.

**If you make or influence policy:** Carry three tests into the room—**exit**, **bargain**, **eval**—and ask whether money buys creation and measured routes, or only uncapped GPU hours. Prefer designs that start with dense umbrellas (campus, then agency) and keep industry on a paying tier.

**If you buy or sell AI for an organization:** Ask vendors for exit rights, published evals, and whether you are renting a **shared utility** or stacking locked seats. Prefer being a paying offtaker who strengthens open routes, not only a reseller of whoever won the last tender.

**If you read, study, or build on your own:** Try the same habit at personal scale—pilot on your real tasks, route by role, keep a path you can leave. Ask your institution whether AI is bought as a shared utility with an exit, or as subscriptions that vanish when terms change.

**If this framing is useful:** Share it, argue with it, or improve it in public. The switchboard only matters if more people can name the failure mode and the competitive alternative.

---

## Closing

The public can field a **Competitive Public AI Switchboard**: a router and pooled buyers that thicken markets, pay open builders, and keep exits real, while private firms compete on merit.

The design is simple to state: start where identity and mission are clear; pay for verified outcomes; rent capacity you can leave; route with evidence; keep humans responsible for decisions that change someone’s life. Whether that machine gets built is a choice for institutions and markets—not a claim that it already exists.

---

## Terminology

| Term | Plain meaning |
| --- | --- |
| **Compute** | The machines, chips, power, and cloud rent needed to run AI. Not “software” in the abstract; the bill for capacity that does the work. |
| **Burn rate** | How fast money disappears. A high burn rate means credits or budget vanish quickly. |
| **Open models / open weight models** | AI you can download and run yourself, instead of only asking a company’s locked chat product for answers. Think: you get the full app to install at home, not only a subscription to someone else’s service. “Open models” in the standfirst means the same idea. |
| **Self hosted** | You run the AI on machines you rent or own. You are responsible for the setup and the bill. Opposite of only using a company’s chat box. |
| **Weights** | Downloadable files that hold the model’s trained skill. **Open weights** = you can take the skill home; **closed** = you only rent answers. |
| **Closed / private API** | You send a request to a company’s server and get an answer back. You do not get to run their full model on your own machines. |
| **Inference** | Day to day answering of prompts: using an already trained model, not the one time job of training it. |
| **Training / pretraining** | The expensive, earlier stage of teaching a model from huge data. Different bill from ordinary chat use. |
| **Foundation model** | A large general model that many apps and tools sit on top of. |
| **GPU** | A costly specialized chip that makes large AI run fast. When this essay says “rent GPUs,” it means renting the expensive AI machines, not a home laptop. |
| **Serving stack** | The software and setup that actually answers user requests (loading the model, sharing work, turning machines off when idle). |
| **Dynamic batching** | Many users share one already loaded model at once, instead of each request waking its own expensive copy. |
| **Quantization** | Running a lighter version of the model that uses less memory, with an accepted quality tradeoff, like compressing video so more people can stream it. Applies to individuals, groups, and the public router. |
| **Scale to zero** | Turn expensive machines off when nobody is using them; wake them when demand returns. |
| **Measured route** | A path (which model, which vendor, which setup) chosen because it won on published tests of quality, cost, and reliability, not because of brand or lobbying. |
| **Open by default, private by merit** | Try downloadable open models first. Use a company model only when a fair bake off shows it is clearly better for that task. |
| **Public Smart Router / public router** | A shared public front door that picks which AI model answers each request, like air traffic control for AI tasks. Needed because tasks differ in quality, speed, and cost; without routing, apps hard-wire one vendor and waste money or quality. |
| **Routing** | Choosing which model and setup should answer this request. Prevents one-size-fits-all spend and keeps exits thinkable when a better measured path appears. |
| **Public switchboard** | The router plus pooled buyers and pricing (umbrellas, capped free use, paid tiers). In short: how people reach AI through a shared public system, not only through private chat subscriptions. |
| **Demand umbrella** | One buyer and one front door for a dense group that already shares identity and mission. Campuses, agencies, and paying industry are **examples of groups**, not a required sequence. |
| **Hire and flip** | Rent capacity from vendors who compete for the contract; leave when a better price or service appears. |
| **Capacity with exit** | The broader move: rent with the right to leave, or enable private builders when new halls are needed, without the state owning the factory. |
| **Offtake / offtaker** | A large buyer who promises to purchase capacity. Makes private investment easier because demand is not a guess. |
| **SLA** | Service promises in the contract (uptime, support, response). |
| **Pipe** | The essential cloud or platform path that others need in order to serve users. |
| **Contestability / fair pipe rules** | Rivals get comparable access on an essential pipe; the pipe owner cannot quietly favor its own model shop. |
| **Match capital** | Public money put beside private money so more builders can raise funds, instead of only subsidizing consumption. |
| **Adverse selection** | When free or cheap resources attract wasteful use. Matching private effort reduces that trap. |
| **Upstream / maintainers** | The people who build and keep open tools healthy. Paying only middlemen while they go unpaid recreates dependence. |
| **Utilization** | How much of the rented machines are actually doing useful work. Idle machines still cost money. |
| **Tokens** | Billing units for many AI APIs (roughly pieces of text processed). Easy to optimize while real learning quality falls. |
| **Eval / evaluation harness** | Automated tests that score model quality and safety on representative tasks before you change the default route. |
| **Soft lock in** | You can leave in theory, but habits, prompts, fine tunes, and workflows make leaving painful in practice. |
| **AI feudalism** | A few landlords of machines and locked APIs; everyone else rents cognition on someone else’s terms. |
| **Scenario blueprint** | A proposed design in this essay, not a claim that any country already runs the whole machine. |

---

## Appendix: ten ways to enable capacity without owning the factory

Optional detail for practitioners. Blend freely (for example: promise to buy capacity + fair access + auction).

| Model | Plain deal | Typical public role | Private role |
| --- | --- | --- | --- |
| **1. Offtake / anchor buyer** | “If you build, we promise to buy X capacity for Y years.” | Guaranteed demand (umbrellas) | Builds, finances, operates |
| **2. Revenue share concession** | “You build and operate; you keep X% of pipe revenue for Z years.” | Grants franchise / rights; sets service rules | Builds; earns share of usage fees |
| **3. Availability payment (PPP)** | “We pay you a fee if the capacity stays up and meets SLA.” | Pays for readiness, not for owning assets | Builds and operates to contract |
| **4. CapEx subsidy / Viability Gap** | “We cover a % of build cost so the project closes.” | Partial capital grant | Raises rest of capital; owns/operates |
| **5. Land, power, permits pack** | “We de risk site, electricity, and approvals.” | Non cash enablement | Still funds and builds the hall |
| **6. Co investment / match** | “We put $1 beside every $N of private money.” | Match fund (creation first spirit) | Leads investment and delivery |
| **7. Tax / accelerated depreciation** | “Faster write offs or holidays if you build here.” | Tax instrument | Builds where the incentive lands |
| **8. Capacity auction** | “Lowest credible bid wins the right to supply the public pool.” | Runs contest; buys from winners | Competes to build or supply |
| **9. Open access mandate on subsidized pipe** | “If you took public help, rivals may buy access on fair terms.” | Fair access condition | Operates; cannot hoard the pipe |
| **10. Hire and flip (pure rent)** | “We rent from whoever is best this year; we do not fund the building.” | Tenant with exit | Existing landlords compete |

---

## Author note

Personal analysis and judgment; AI assisted the research and drafting. Linked Sources support named programs. Scenario designs are proposals, not claims that any country already runs this system. Verify primary sources before you act.

---

## Sources

| Program | Link |
| --- | --- |
| Modal shared open weight endpoint (private market example) | https://modal.com/blog/kimi-k3-by-moonshot-now-available-on-modal |
| Canada AI Compute Access Fund | https://ised-isde.canada.ca/site/ised/en/canadian-sovereign-ai-compute-strategy/ai-compute-access-fund |
| Canadian Sovereign AI Compute Strategy | https://ised-isde.canada.ca/site/ised/en/canadian-sovereign-ai-compute-strategy |
| Israel Innovation Authority (home) | https://innovationisrael.org.il/en/ |
| Yozma 2.0 (match style) | https://innovationisrael.org.il/en/calls_for_proposal/yozma-2-0-fund/ |
| MAGNET / applied research consortia | https://innovationisrael.org.il/en/programs/applied-research-consortiums/ |
| Germany Sovereign Tech Fund (SPRIND) | https://www.sprind.org/en/impulses/projects/sovereign-tech-fund |
| AI Alliance Project Tapestry | https://thealliance.ai/projects/tapestry |
| National Security Case for Public AI (VPA PDF) | https://cdn.vanderbilt.edu/vu-URL/wp-content/uploads/sites/412/2024/09/27201409/VPA-Paper-National-Security-Case-for-AI.pdf |


---
