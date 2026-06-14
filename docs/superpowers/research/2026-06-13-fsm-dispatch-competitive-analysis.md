# Field Service Management — Dispatch Capability Competitive Analysis

| Field | Value |
| ----- | ----- |
| Status | Research / benchmarking |
| Date | 2026-06-13 |
| Author | Agent (for Mark Bodman) |
| Scope | Market comparison of FSM dispatch capabilities vs. DPF's designed dispatcher role |
| Anchors | [Field Service Trades — AI Dispatch design](../specs/2026-05-19-field-service-trades-ai-dispatch-design.md), [HVAC dispatcher workspace home plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md), [Dale HVAC persona](../../personas/dale-hvac.md) |
| Why now | Backlog is not in this build (backed up, ~700 BIs); dispatcher work is being done directly in the worktree during archetype testing. This grounds the dispatcher feature set against the live 2026 market. |

---

## 1. Our dispatcher need (the evaluation criteria)

DPF's dispatcher is **one role with two surfaces over one work substrate** (`WorkItem`, `sourceType = "field-service-job"`):

1. **Dispatcher AI coworker** — the autonomous coordinator (replaces the "owner's wife as dispatcher"): T-24h appointment confirmation, on-my-way notification, running-late ETA cascade, customer-notification routing by preference, pre-job brief, invoice-from-job, and (later) AI inbound call answering. Source: [AI Dispatch design §8.2](../specs/2026-05-19-field-service-trades-ai-dispatch-design.md).
2. **Dispatcher workspace home** — the human operator's first-viewport dispatch board (Dale's AC repair proving install): technician schedule/load, jobs needing attention (unassigned/emergency/parts-blocked/unconfirmed), coworker handoffs (PAR + Governor HITL), customer/route map, truck stock, failed customer updates. Source: [HVAC dispatcher workspace home plan](../plans/2026-06-04-hvac-dispatcher-workspace-home.md).

The capability dimensions we measure the market against:

| # | Dimension | DPF source |
| - | --------- | ---------- |
| D1 | AI inbound call answering → booked job | `BI-FS-025` |
| D2 | Storefront / online booking | archetype storefront |
| D3 | Visual dispatch board / queue | workspace home (decision-queue) |
| D4 | AI auto-assign by skill / proximity / availability | §7 dispatch optimization; capacity-lanes |
| D5 | Route / ETA optimization | Sprint 4 GPS ETA |
| D6 | Real-time reschedule / running-late cascade | `BI-FS-007` |
| D7 | Multi-technician capacity & load view | capacity-lanes |
| D8 | Appointment confirmation (T-24h) | `BI-FS-005` |
| D9 | On-my-way notification | `BI-FS-006` |
| D10 | Notification routing by preference (SMS/call/email) | ADR-3 |
| D11 | Failed-delivery exception surfacing | communication-exceptions |
| D12 | Voice-first field input | ADR-4 |
| D13 | Equipment / site history | `BI-FS-014` |
| D14 | Truck stock / van inventory | `BI-FS-029` (Dale's first feature) |
| D15 | EPA 608 refrigerant compliance | `BI-FS-020/021/022` |
| D16 | Utility rebate intelligence | `BI-FS-023` |
| D17 | AHRI system-match validation | `BI-FS-024` |
| D18 | QuickBooks / accounting sync | ADR-5 |
| D19 | Unified board+AI over one work substrate | ADR-1 |
| D20 | Hive-mind cross-install learning | §13 |

---

## 2. The market has split the dispatcher into two products

The single most important finding. In 2026 the field-service market sells **two distinct things**, often by different vendors:

- **The dispatch board** — a human-operated queue. Drag-and-drop calendar, GPS tracking, technician assignment, job lifecycle. Every all-in-one FSM ships one. *Manages* the queue.
- **The AI dispatcher** — a front-end autonomous layer. Answers inbound calls within ~60s, qualifies the request, triages urgency, books the job into the FSM, and (newest tier) autonomously builds and self-adjusts the whole schedule. *Fills and optimizes* the queue.

The pure-play AI-dispatcher vendors explicitly frame these as **"complementary, not competing"** — the AI dispatcher fills the queue through automated call intake; the dispatch app manages it through technician assignment ([FlowSystem, 2026-05-18](https://blog.flowsystem.ai/2026/05/18/hvac-dispatch-app-vs-ai-dispatcher-2026/)).

**DPF's design collapses this split.** The Dispatcher AI coworker and the dispatcher workspace board are the *same role* reading and writing *one* `WorkItem` substrate (ADR-1). The market treats "AI that books" and "board that schedules" as two integrations that must be wired together; DPF treats them as one coworker with an autonomous mode and an operator surface. That is the architectural differentiator worth protecting.

---

## 3. Market taxonomy & dispatch capability by vendor

### Tier 1 — SMB all-in-one FSM (Dale's direct competitors)

- **Housecall Pro** — drag-and-drop dispatch board, real-time technician tracking, "on my way" GPS texts. 2026 added **"AI Dispatching"** (optimizes the daily schedule from historical job times + skill sets — e.g. routes a NATE-certified heat-pump tech to high-efficiency installs) plus an **"AI Team"** that books jobs and handles admin. Mid-market sweet spot: more than Jobber, far cheaper/simpler than ServiceTitan ([Housecall Pro](https://www.housecallpro.com/compare/housecall-pro-jobber/), [Jobber comparison](https://www.getjobber.com/comparison/jobber-vs-housecall-pro/)).
- **Jobber** — clean calendar-based scheduling, GPS, automated reminders. AI investment is in **"Smart Quotes"** (analyzes last 500 quotes to suggest profitable pricing by zip/job type), *not* dispatch. Simplicity-first ([Jobber](https://www.getjobber.com/comparison/jobber-vs-housecall-pro/)).
- **FieldEdge** — HVAC-specialist, 45 years. **Smart dispatch board** with GPS and skill+location-based service-call assignment suggestions; the cleanest QuickBooks (Desktop & Online) integration in the market; Coolfront flat-rate + service agreements ([Software Advice](https://www.softwareadvice.com/field-service/fieldedge-profile/), [Contractor ToolStack](https://contractortoolstack.com/software/fieldedge/)).
- **Workiz** — clean dispatch board with **built-in VoIP** (call tracking, recording, virtual number); every inbound call is logged, recorded, and converts to a job in one click. Strong specifically for the dispatcher seat ([FieldCamp roundup](https://fieldcamp.ai/blog/best-hvac-scheduling-software/)).
- **ServiceM8** — modern lightweight option; launched **ServiceM8 Phone Agent** (Sept 2025) moving toward AI call handling.
- *(also: FieldPulse, Service Fusion, ServiceAgent — same band.)*

### Tier 2 — Mid-market / enterprise trades

- **ServiceTitan + Dispatch Pro** — the benchmark. **Dispatch Pro** (AI add-on, "Titan Intelligence") auto-assigns technicians by skill, performance data, and proximity, returns confidence-scored recommendations, and reassigns on cancellations/delays. Configurable to optimize **drive time, average ticket size (revenue), or a blend**. **Route Optimization Automation** builds schedules in one click; **Smarter Routing** (visual map builder) reaches GA summer 2026. Expensive ($150–$500+/mo/tech band) ([Dispatch Pro](https://www.servicetitan.com/features/pro/dispatch), [FieldCamp pricing](https://fieldcamp.ai/reviews/servicetitan/)).
- **BuildOps** — commercial HVAC/plumbing. Dispatch board shows assignments **across days, not just hours** (a chiller replacement runs a week); project-based jobs, per-building equipment, contract lifecycle, subcontractor skill filtering ([geekflare](https://geekflare.com/software/best-field-service-management-software/)).

### Tier 3 — Enterprise workforce / asset FSM (agentic frontier)

- **Salesforce Field Service + Einstein / Agentforce** — IDC MarketScape Leader (AI-enabled FSM 2025–2026). Constraint-based optimization on Work Rules + Work Objectives with street-level routing/traffic; **up to 25% travel-time reduction**. Agentforce brings agentic AI to scheduling, schedule-gap resolution, job wrap-up, and on-the-job troubleshooting ([Salesforce](https://www.salesforce.com/blog/field-service-scheduling-optimization-in-the-agentforce-era/)).
- **Microsoft Dynamics 365 Field Service + Copilot** — **Scheduling Operations Agent** + Copilot-assisted dispatch; dispatchers ask Copilot to suggest available technicians and optimal routes; new Crew Allocation forms a "same-day response layer." Cites **20–30% efficiency gains** in dispatch/scheduling (Gartner 2025) ([Microsoft Learn 2026 Wave 1](https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/service/dynamics365-field-service/), [Rand Group](https://www.randgroup.com/insights/microsoft/ai-in-action-transforming-dynamics-365-field-service-with-copilot/)).
- **IFS Field Service Management** — Gartner Leader; **PSO** (Planning & Scheduling Optimization) engine; workforce forecasting/planning that most vendors overlook ([IFS](https://www.ifs.com/solutions/capabilities/workforce-scheduling-and-planning/pso-calculator)).
- *(also: Oracle Field Service, ServiceMax, SAP FSM — asset/contract-centric, constraint optimization.)*

### Tier 4 — AI-dispatcher pure-plays (the new 2026 category, closest to our coworker)

- **FieldCamp AI Dispatcher** (launched on Microsoft Marketplace, June 2026) — **fully autonomous dispatch**: matches each job to the right tech by skill, location, availability, equipment, and real schedule constraints, returns a confidence-scored recommendation in seconds, **builds the entire schedule without human input and self-adjusts in real time**, including **emergency reshuffling**. Handles the **inbound call workflow** (answers, qualifies, triages urgency, books) 24/7 with no human dispatcher on duty. From **$199/mo, no per-seat fees**; aimed at HVAC/plumbing/electrical/landscaping/cleaning/pest still dispatching by hand. One 15-tech AZ HVAC contractor reportedly booked **40% more jobs without hiring** ([FieldCamp launch](https://roboticsandautomationnews.com/2026/03/19/fieldcamp-introduces-ai-dispatcher-for-field-service-skills-matching-route-optimization-and-emergency-reshuffling-built-for-the-trades/99895/), [OpenPR](https://www.openpr.com/news/4542923/fieldcamp-launches-ai-dispatcher-on-microsoft-marketplace)).
- **FlowSystem, ServiceAgent, HVAC Tools AI, QuoteIQ** — same pattern: AI front-desk that answers, qualifies, books, and confirms by text, feeding ServiceTitan/Jobber.

---

## 4. Capability matrix

Legend: ● native / strong · ◐ partial or add-on · ○ absent · ◆ **DPF designed (not yet built)**

| Dim | Capability | HousecallPro | Jobber | FieldEdge | Workiz | ServiceTitan+DispatchPro | BuildOps | D365/Salesforce | FieldCamp (AI) | **DPF (designed)** |
| --- | ---------- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| D1 | AI inbound call answering | ◐ | ○ | ○ | ◐ | ○ | ○ | ◐ | ● | ◆ |
| D3 | Visual dispatch board | ● | ● | ● | ● | ● | ● | ● | ○ | ◆ |
| D4 | AI auto-assign (skill/proximity) | ● | ○ | ◐ | ○ | ● | ◐ | ● | ● | ◆ |
| D5 | Route/ETA optimization | ◐ | ◐ | ◐ | ◐ | ● | ◐ | ● | ● | ◆ |
| D6 | Real-time reschedule / late cascade | ◐ | ○ | ◐ | ◐ | ● | ◐ | ● | ● | ◆ |
| D7 | Technician capacity/load view | ● | ● | ● | ● | ● | ● | ● | ◐ | ◆ |
| D8 | Appointment confirmation | ● | ● | ● | ● | ● | ● | ● | ● | ◆ |
| D9 | On-my-way notification | ● | ● | ● | ● | ● | ● | ● | ◐ | ◆ |
| D10 | Notification routing by preference | ◐ | ◐ | ◐ | ● | ● | ◐ | ● | ◐ | ◆ |
| D11 | Failed-delivery exception surfacing | ○ | ○ | ○ | ◐ | ◐ | ○ | ◐ | ○ | ◆ |
| D12 | Voice-first field input | ○ | ○ | ○ | ○ | ◐ | ○ | ◐ | ○ | ◆ |
| D13 | Equipment / site history | ◐ | ○ | ● | ◐ | ● | ● | ● | ○ | ◆ |
| D14 | Truck stock / van inventory | ◐ | ○ | ◐ | ◐ | ● | ● | ● | ○ | ◆ |
| D15 | EPA 608 refrigerant compliance | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◆ |
| D16 | Utility rebate intelligence | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◆ |
| D17 | AHRI match validation | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ◆ |
| D18 | QuickBooks sync | ● | ● | ● | ● | ● | ● | ◐ | ○ | ◆ |
| D19 | Board + AI on one substrate | ○ | ○ | ○ | ○ | ◐ | ○ | ◐ | ○ | ◆ |
| D20 | Hive cross-install learning | ○ | ○ | ○ | ○ | ◐ | ○ | ○ | ◐ | ◆ |

Note: DPF's entire column is ◆ — designed, not shipped. The matrix states the *target* parity, not current reality. Current reality: none of D1–D20 is implemented in this build (no `hvac-contractor` archetype, no seeded Dispatcher coworker, no workspace `contributions/`).

---

## 5. Gap analysis

### 5.1 Where the market is ahead of our *design* (close these)

- **AI auto-assign is now table stakes, and it's revenue-aware.** ServiceTitan Dispatch Pro and Housecall Pro AI both assign by skill + proximity, and ServiceTitan optimizes on **average ticket size**, not just geography. Our §7 lists "dispatch optimization (multi-technician)" as a *Low* priority. The market says it's mid/high. Our auto-assign should consider revenue/upsell value, not only route.
- **Route optimization with real traffic.** Salesforce/ServiceTitan do street-level routing with traffic; we have a deferred "mapping API" choice (OpenRouteService default). Fine for MVP, but the bar is traffic-aware.
- **Autonomous, self-adjusting schedules.** FieldCamp builds and continuously re-optimizes the whole schedule. Our "running-late cascade" (`BI-FS-007`) is reactive to one job; the frontier is continuous whole-board optimization. Architecture should not preclude it.
- **Built-in telephony as a dispatcher feature.** Workiz's VoIP (every call logged/recorded → one-click job) is a strong dispatcher-seat pattern. Our inbound calling is a late sprint (`BI-FS-025`) gated on TTS.

### 5.2 Where our design is ahead of the entire market (protect these)

- **D15 EPA 608, D16 rebate intelligence, D17 AHRI** — **zero** mainstream or AI-pure-play vendor covers these. Confirmed across ServiceTitan, Housecall Pro, Jobber, FieldEdge, FieldCamp. This is a genuine moat for the HVAC leaf and a sales-before-demo hook ("every job logs your 608 automatically").
- **D19 unified board + AI over one substrate.** The market wires an AI-dispatcher product to a separate dispatch-board product. DPF models one dispatcher role, two surfaces, one `WorkItem`. Less integration surface, one source of truth for "what work is open."
- **D12 voice-first field input** as the primary (not bolt-on) field pathway. Enterprise tiers have Copilot "listen on the go"; SMB tier has none. Our ADR-4 makes voice the default for dirty-hands field work.
- **D20 hive-mind cross-install learning** — anonymized pricing/notification-timing/duration defaults fed back to every new HVAC install. The closest analog is each vendor's *own* data lake; none shares improved defaults across independent contractors the way DPF's hive does.
- **Conduit model (ADR-7).** Financing/rebates surfaced as pre-filled forms the operator submits under their own account — no partner enrollment, no referral-fee conflict. Differentiator in trust/positioning, not features.

### 5.3 Strategic read

The market is racing toward **autonomous dispatch** (FieldCamp, Agentforce, D365 Scheduling Agent) on the efficiency axis — answer faster, assign smarter, route tighter, 20–40% gains. That axis is getting crowded and will commoditize. DPF should reach **parity** there (auto-assign, route, confirmation, on-my-way — D4/D5/D8/D9 are the must-haves to not look broken) but **compete on the axes nobody else is on**: compliance-as-a-byproduct-of-the-job (608/AHRI), rebate-at-estimate close-rate lift, voice-first field UX, hive-shared defaults, and the unified single-substrate model. Those are durable; raw scheduling speed is not.

---

## 6. Recommendations for the dispatcher build (worktree-direct, no backlog)

1. **MVP dispatcher = parity table-stakes only:** D3 board + D4 skill/proximity auto-assign + D8 confirmation + D9 on-my-way. That is the smallest thing that reads as a real dispatcher to an HVAC owner.
2. **Make auto-assign value-aware from day one** (skill + proximity + simple revenue/urgency weight), since the market already optimizes on ticket size — cheap to design in, expensive to retrofit.
3. **Keep the running-late cascade architecturally open to whole-board re-optimization**, even if v1 only recalculates the affected chain.
4. **Lead the HVAC archetype with the moat, not the parity:** seed EPA 608 + rebate lookup early — they're the reason to switch, and they cost the market nothing to ignore because none of them have it.
5. **Hold the unified-substrate line:** resist any pressure to model the AI dispatcher and the board as two systems. One `WorkItem`, one dispatcher role, two surfaces.

---

## 7. Sources (all reviewed 2026-06-13)

- ServiceTitan Dispatch Pro — https://www.servicetitan.com/features/pro/dispatch ; pricing https://fieldcamp.ai/reviews/servicetitan/
- Housecall Pro vs Jobber — https://www.housecallpro.com/compare/housecall-pro-jobber/ ; https://www.getjobber.com/comparison/jobber-vs-housecall-pro/
- HVAC dispatch app vs AI dispatcher (FlowSystem) — https://blog.flowsystem.ai/2026/05/18/hvac-dispatch-app-vs-ai-dispatcher-2026/
- FieldCamp AI Dispatcher launch — https://roboticsandautomationnews.com/2026/03/19/fieldcamp-introduces-ai-dispatcher-for-field-service-skills-matching-route-optimization-and-emergency-reshuffling-built-for-the-trades/99895/ ; https://www.openpr.com/news/4542923/fieldcamp-launches-ai-dispatcher-on-microsoft-marketplace
- FieldCamp HVAC scheduling roundup — https://fieldcamp.ai/blog/best-hvac-scheduling-software/
- FieldEdge — https://www.softwareadvice.com/field-service/fieldedge-profile/ ; https://contractortoolstack.com/software/fieldedge/
- BuildOps / FSM roundup — https://geekflare.com/software/best-field-service-management-software/
- Dynamics 365 Field Service 2026 Wave 1 — https://learn.microsoft.com/en-us/dynamics365/release-plan/2026wave1/service/dynamics365-field-service/ ; https://www.randgroup.com/insights/microsoft/ai-in-action-transforming-dynamics-365-field-service-with-copilot/
- Salesforce Field Service / Agentforce — https://www.salesforce.com/blog/field-service-scheduling-optimization-in-the-agentforce-era/
- IFS PSO — https://www.ifs.com/solutions/capabilities/workforce-scheduling-and-planning/pso-calculator
- TechTarget FSM vendors 2026 — https://www.techtarget.com/searchcustomerexperience/tip/Field-service-management-software-vendors-to-know
