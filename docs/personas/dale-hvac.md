# Dale, Owner at a 4-truck HVAC repair shop - DPF persona

## Snapshot

- **Business**: Local HVAC repair shop keeping residential and light-commercial customers running when heating or cooling fails.
- **Size**: 4 trucks; small owner-operated shop. Employee count, revenue, and geography were not specified in the dogfood source.
- **Tech baseline**: Types with two fingers, has never opened a terminal, and calls every tool an "app."
- **What they don't have**: A simple way for technicians to know what parts are on each truck, plus a software-building experience that speaks shop language instead of platform language.
- **Archetype**: Target leaf `hvac-contractor`; current category `trades-maintenance`. The catalog seeds `facilities-maintenance`, `plumber`, `electrician`, `cleaning-service`, and `landscaping`; `hvac-contractor` is not yet seeded.
- **IT4IT value streams they care about**: `strategy-to-portfolio`, `requirement-to-deploy`, `request-to-fulfill`, `detect-to-correct`, `deploy-to-operate`.

## The narrative (marketing-grade)

Dale is not shopping for software because he wants another dashboard. He has four trucks on the road, calls coming in, customers waiting in service windows, and technicians losing daylight when they discover the part they need is sitting back at the warehouse. Every unnecessary drive back is a late arrival somewhere else, a callback risk, and another moment where the shop feels smaller than the demand placed on it.

What Dale wants is ordinary in his words and powerful in its consequences: show each technician what is already on the truck, let them update the list when they use a part, and make restocking obvious before the next service call. He does not want to learn what a work capsule, model route, design gate, or branch means. He wants to say the problem once and see the system help him turn it into something his crew can use.

DPF earns Dale only when it behaves like a calm shop helper. It needs to ask plain questions, keep visible progress while it works, and recover honestly when something is too big or stuck. The Dale dogfood showed the strategic value of this kind of persona testing: a single first-feature attempt surfaced dozens of defects that abstract capability planning had missed.

## What they ask DPF to build (the first feature)

"I want to know what parts each truck has so my guys stop driving back to the warehouse."

This first feature should stay small for the smoke run:

- Show each truck.
- Show the parts currently stocked on that truck.
- Let a technician mark parts used during a job.
- Make low-stock or missing parts visible for restock.

The source Build Studio build is `FB-6F7D6AC4`, under Dale's hardening epic `EP-9FC5D2FD`.

## What the platform needs to be like for them

- **Vocabulary** they expect: trucks, techs, parts, warehouse, jobs, service calls, customers, look up, update the list, pull parts, restock, on my way.
- **Vocabulary to avoid**: FeatureBuild, work capsule, branch, build ID, model route, MCP tool, evidence, taxonomy, IT4IT, schema, designDoc, buildPlan, sandbox container, GearInterface, torque, ring, slip, cockpit.
- **Coworkers** they need active: Build Studio Software Engineer for the first feature; Dispatcher-style coworker for daily schedule and customer updates; Field Technician-style coworker for mobile job and parts-used updates. The Dispatcher and Field Technician roles are designed in the field-service spec but must be checked against seed reality before a dogfood run.
- **Critical features**: obvious "start a build" entry, provider readiness gate, multiline intake, visible long-running progress, correct active-build targeting, review-loop convergence, plain-language status banners, live preview tied to the active build, internal ID hiding, truck inventory lookup/update, and archetype-aware hive applicability.
- **Mostly irrelevant at first touch**: architecture maps, code intelligence chips, model/provider IDs, branch/capsule metadata, raw admin backlog mechanics, generic portfolio language, and release internals.
- **Surfaces they'll touch first**: `/welcome`, `/login`, `/workspace`, `/build`, `/platform/ai/providers` only if setup is blocked, live preview, and later a mobile or technician surface for truck stock.
- **Surfaces they should NEVER see**: tool traces, admin internals, raw model IDs, Git branch names, MCP/tool names, schema field names, internal failure handlers, IT4IT/EA jargon, GearInterface terms, or unrelated platform self-upgrade work.

## Marketing extractables

- **Punch quote**: "Dale does not need to understand how software ships; he needs to trust that his request is moving."
- **Punch quote**: "The first feature is tiny in words: show me what is on each truck. The business impact is not tiny."
- **Punch quote**: "DPF wins the HVAC shop when it sounds like the shop, not like a software factory."
- **Before/after hero block**: Before DPF, Dale's technicians lose time driving back to the warehouse because nobody can see truck stock clearly. After DPF, each truck has a simple parts list technicians can check and update from the field, and the shop sees restock needs before the next job slips.
- **Feature soundbite**: Truck stock lookup stops wasted warehouse runs.
- **Feature soundbite**: Parts-used updates turn field work into restock signals.
- **Feature soundbite**: Dispatcher context keeps customer delays from cascading silently.
- **Feature soundbite**: Build Studio must show progress in plain English while the AI works.
- **Feature soundbite**: Hive contributions must go only to matching field-service archetypes, not every DPF install.
- **Permission to use?** Pseudonym/synthetic persona derived from dogfood. Not a real customer story unless explicitly replaced with a customer-approved case study.

## Test scenarios (re-runnable dogfood)

- From a fresh or reset customer install, reach the build surface without needing to know whether "Backlog," "Portfolio," or "Build Studio" is the right word. Links: `BI-EC26D09D`, `BI-950FE085`.
- Enter Dale's first-feature request into the build intake and confirm the whole sentence remains visible in a multiline field. Link: `BI-950FE085`.
- With no strong remote provider configured, confirm `/build` blocks honestly with one "connect a provider" path and never promises a model re-route that cannot happen. Links: `BI-7DA88A81`, `BI-0BDA630D`, `BI-D6740C86`.
- With strong providers configured, submit the truck-stock feature and confirm the coworker asks shop-language questions. It must not show setup prompts, tool names, schema fields, raw model IDs, or fake prior user messages. Links: `BI-253ADC70`, `BI-4C478ACF`, `BI-62442F75`.
- Start Ideate research and confirm the UI stays visibly busy while background work continues. The research must attach to Dale's active build, not the most recently updated ideate build. Links: `BI-78499309`, `BI-F4A30FCB`.
- Advance from Ideate to Plan and confirm the status strip does not immediately show a false "missing evidence" warning at the phase boundary. Links: `BI-62075FF9`, `BI-DFC11F59`.
- Re-run Plan iteration for the truck-stock feature and confirm review iterations converge or stop with a clear split-scope recommendation. It must not oscillate between task granularities for 30 minutes. Link: `BI-4396EFEC`.
- Force or simulate a max-iteration fallback and confirm the recovery message remains deterministic and domain-correct. It must not suggest unrelated finance reports while Dale is building truck inventory. Link: `BI-0C19AFDD`.
- Switch between two builds, then open live preview from Dale's build. The preview must open the active truck-stock build, not a stale "driving" build from another thread. Link: `BI-EEC5A5ED`.
- Open `/workspace` as Dale's install once `BI-CE6AF925` lands and confirm the first viewport is a dispatch board with today's jobs, unscheduled jobs, technician load, customer update failures, parts/units, and coworker handoffs.
- When the truck-stock feature is ready for hive contribution, confirm applicability metadata limits it to field-service/mobile-inventory archetypes by default. A dental practice, law firm, or restaurant install should not see it as a recommended feature. Link: `BI-76E66F9B`.
- Smoke the shipped feature itself: create two trucks, add parts to each, look up parts from a technician view, mark one part used, and confirm restock visibility updates.

## Dogfood history

| Date | Phase reached | Deficiencies surfaced | Outcome |
| ---- | ------------- | --------------------- | ------- |
| 2026-05-23 | Initial Build Studio first-touch run | D1-D23: first-run entry confusion, login/setup gaps, platform vocabulary, prompt leaks, intake affordance, internal IDs, local-model failure, false re-route promise | Dale hard-blocked before useful progress; produced the first hardening epic `EP-9FC5D2FD`. |
| 2026-05-23 | Provider-configuration path | D24-D28: provider page wording, stale capability tier, weak configure CTA, stale model list, provider-unavailable spam | Confirmed that provider setup is part of the first-customer experience, not an admin afterthought. |
| 2026-05-24 | Phase E - strong providers connected | D31-D32: background work looked idle; research targeted the wrong build under concurrent ideate builds | Stronger providers improved coworker behavior, but async progress and build targeting became the next blockers. |
| 2026-05-24 | Phase F - D32 behavioral verification | Rebuild and provider-fetch blockers prevented behavioral E2E confirmation | Unit/source evidence existed for D32, but the live Dale run still needed another go. |
| 2026-05-24 | Phase G - design review / Plan transition | D33, D14 refinement, archetype-applicability gap | Tool-name leakage and false phase-boundary warnings still made the flow feel like an engineer console; reusable feature contribution needed archetype filtering. |
| 2026-05-24 | Phase H - Plan iteration | D34, D36, D37, D38 | New persona Build Studio runs should wait until D38 plan-iteration divergence is fixed; otherwise they will likely hit the same cliff. |

## Open BIs from this persona's dogfooding

Live backlog check on 2026-05-24 showed these non-done items under `EP-9FC5D2FD`:

| BI | Live status | Trace |
| -- | ----------- | ----- |
| `BI-4396EFEC` | triaging | D38 - Plan-review iteration loop oscillates without converging. |
| `BI-0C19AFDD` | triaging | D37 - Max-iteration handler confabulates unrelated finance-report recovery hints. |
| `BI-2ECD7499` | triaging | D36 - ModelWarmup pollutes quality issue reporting on every page load. |
| `BI-EEC5A5ED` | triaging | D34 - Bottom status-bar driving pointer goes stale across builds. |
| `BI-DFC11F59` | triaging | D14 refinement - missing-evidence gate must be phase-attempt-aware. |
| `BI-62442F75` | triaging | D33 - `reviewDesignDoc` tool name leaks into a Build Studio status banner. |
| `BI-76E66F9B` | triaging | Hive contribution must carry archetype applicability. |
| `BI-F4A30FCB` | triaging | D32 - Ideate/scout research can target the wrong build under concurrency. |
| `BI-78499309` | triaging | D31 - Long-running async work has no visible progress signal. |
| `BI-09A48EAD` | triaging | Portal no-cache rebuild fails during Prisma generate, blocking behavioral verification. |
| `BI-87D93A71` | triaging | ChatGPT/Codex OAuth port-switch UX cleanup. |
| `BI-253ADC70` | triaging | Coworker chat hygiene: setup prompts, fabricated demo turns, auto-greeting. |
| `BI-950FE085` | triaging | Build Studio intake affordance: multiline description and start-build CTA. |
| `BI-63EAD801` | triaging | Hide internal IDs, capsule slugs, and git branch chips. |
| `BI-62075FF9` | triaging | Status-strip cleanup family. |
| `BI-EC26D09D` | triaging | Portal first-touch labeling and platform-update banner. |
| `BI-4C478ACF` | triaging | Provider-setup concierge and route/capability context. |
| `BI-7DA88A81` | in-progress | G1 - Build Studio entry gate when no strong-tier remote provider is active. |
| `BI-D6740C86` | in-progress | Provider configuration UX cleanup. |
| `BI-0BDA630D` | in-progress | G2 - Honest failure-handler messages. |

## Source evidence

- Primary dogfood log: [2026-05-23 Dale HVAC Build Studio dogfood](../dogfood/2026-05-23-dale-hvac-build-studio.md).
- Field-service archetype and architecture grounding: [Field Service Trades design](../superpowers/specs/2026-05-19-field-service-trades-ai-dispatch-design.md) and [Field Service Sprint 1 plan](../superpowers/plans/2026-05-19-field-service-sprint-1.md).
- Workspace-home anchor: [Vertical Workspace Home design](../superpowers/specs/2026-05-24-vertical-workspace-home-design.md).
- Archetype seed reality: `packages/storefront-templates/src/archetypes/trades-maintenance.ts`.
- Live backlog source at creation: MCP `list_backlog_items(epicId="EP-9FC5D2FD")`, `get_backlog_item("BI-4396EFEC")`, `get_backlog_item("BI-CE6AF925")`, and `list_backlog_items(epicId="EP-REDUCTION-GEAR-ARCH")` on 2026-05-24.
