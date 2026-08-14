# A Governance Gate on Consequential Tool Use (WWWD-grounded)

**Date:** 2026-08-13 · **Origin:** customer-zero dogfood · **Owner ask:** platform owner
**Supersedes the narrow scope of** BI-7E1F128A (which was "make the WWWD score discriminate by content"). That BI is a symptom; this spec is the mechanism.

## The pattern (generalized)

The recurring shape is **a gate that must be cleared before any consequential tool call executes** — adding a product, paying a bill, emailing a client, sending a quote, publishing content. Every such action is a *tool-mediated* commitment, and each clears the same governance gate first. The "does the toaster fit our mission?" case is one instance; the general mechanism is a **pre-execution governance interceptor** that, for every consequential tool call, extracts what the action *is*, checks it against the company's stance + relevant corpora + policy, and **vetoes, allows, or escalates** before the tool runs. This is the concrete form of the org stance *"keep humans in control of consequential automated decisions."*

## Same shape as an agent permission layer

Structurally this is the **agent permission / auto-mode validation pattern**: a middleware step that intercepts each tool call and returns *allow / deny / ask* before it executes, guarding against bad consequences. The distinction — and the DPF differentiator — is the **policy source**: Claude's auto-mode validates against generic harm heuristics plus user allow/deny rules; this gate validates against the **company's own authored policy** (WWWD stance + product portfolio + GTM + authority/spend limits). It is a **Policy Decision Point (PDP) invoked as tool-use middleware**, where the policy is the organization's constitution, is owner-editable, and is amended (not bypassed) to change what the org permits. Implement it as a tool-call interceptor/hook, not as an optional advisory call each agent must remember to make.

## Placement in the standards family (TAK / GAID / JSI) and decision scopes (WWMD / WWWD / WSID)

This gate is not new machinery bolted on — it is the composition and wiring of constructs the standards family already defines. Build it *as* a TAK control surface, not beside one.

- **TAK (Trusted AI Kernel) — the home.** TAK defines the runtime's explicit control surfaces for *authority, approvals, tool calls, delegation, failure, evidence*. The gate is the **alignment/approval control surface on consequential tool calls**, and must be a first-class part of the TAK harness so no agent can act around it (interceptor, not an advisory call each agent remembers to make).
- **GAID — the actor.** The invoking agent's GAID identity is what the gate attributes and traces; each gate decision is a **GAID-traceable receipt** in the ledger (who acted, under what delegated authority).
- **JSI (TAK-JSI) — coordination vs specialist.** The **coordination layer** (orchestrator / overarching thread) emits the action and routes the check; it **delegates the precise domain check to a specialist profile**. That delegation runs through **TAK-JSI qualification**: the specialist must be *qualified* for this job/activity/data/risk or the runtime **fails closed, narrows, or escalates**. Load-bearing JSI rule carried through: **a JSI qualification is *not* permission to act** — qualification gates *who may run the check*; the gate still layers WWWD alignment + authority on top before the action lands.
- **Decision scopes — WWWD × WSID (× WWMD).** The verdict composes two scopes:
  - **WWWD (organization):** does this action fit the company — mission / market / product / GTM? (coordination-level, the org constitution).
  - **WSID (profession):** the specialist applies its **craft**, scored through `evaluate_profession_decision` against its **profession corpus** (specialist-level).
  The specialist's **WSID** verdict on its domain feeds the coordination-level **WWWD** decision; both must clear, and **veto** applies across them. **WWMD (platform)** is the sibling scope for platform-build decisions — same shape, different corpus.

So: **coordination layer** = WWWD org-alignment + orchestration + veto authority; **specialist layer** = JSI-qualified profile applying WSID craft to its corpus and returning a verdict. The toaster's "resounding no" is a coordination-level WWWD market/mission fail *and* a specialist-level WSID product-portfolio fail, either of which vetoes.

## Standards conformance — the discipline that keeps this and future work in check

This gate is not a bespoke feature; it is the **TAK action-gating control** for consequential tool use, and it must conform to the DPF **Trustworthy AI Agent Standards Family** (`docs/architecture/agent-standards-family.md`). Conformance is what keeps this work — and every capability built after it — coherent:

- **TAK** (Trusted AI Kernel) owns *may this agent act, under whose authority, through which tools/data, with what oversight and evidence* — i.e. **action gating at execution**. This gate realizes that control for the WWWD×WSID **alignment** dimension.
- **GAID** resolves the acting identity + operating profile and binds the **action receipt** back to the subject (the ledger entry).
- **TAK-JSI** determines whether the delegated specialist's operating profile is **qualified** for the job / data scope / risk of the check.
- **Composition rule (normative):** `GAID identity → JSI qualification → TAK intersection (authority × grants × route/workflow policy × data constraints × qualification ceiling) at execution → GAID receipt`. This gate slots in at the TAK step and consults the WWWD/WSID policy corpora.
- **No-widening invariants (must hold):** a GAID claim is not authorization; a JSI qualification is not permission to act; a TAK permission is not evidence of competence. The gate must never let one layer widen another.

Because the gate is a TAK control, **every future consequential capability inherits governance by passing through it** — the standards family is the check that keeps new work in line, not a one-off review.

## Problem

The WWWD org business-decision path does not let the company's stated stance govern decisions. Live proof (customer-zero install, 2026-08-13): with an explicit stance *"we decline selling toasters to fishermen in Alaska…"* **embedded and semantically matched**, `evaluate_org_business_decision` still returns `stanceAlignment: approve` for the toaster. Root causes:

1. **Wrong vectors.** The decision is scored on *operational* axes (`speed_to_value, reversibility, blast_radius, cognitive_load, governance_compliance, maintainability`). **None expresses strategic alignment** — mission fit, market fit, product fit, GTM fit. So "is this on-mission?" is not a dimension the scorer can weigh.
2. **Stance content is not projected into criteria.** The `principleDimensionVector` / stance→dimension mechanism exists (BI-E1427A3E) but WWWD org stances (pageKind `stance`) are not projected into it — the stance is matched as an opaque blob, not decomposed into checkable criteria.
3. **Coarse aggregate, no veto.** Relevance is averaged over all stances; generic positive stances ("we help businesses") outweigh a specific decline-boundary. A hard "no" gets diluted to "approve."
4. **Portfolio/GTM corpora not consulted.** The product portfolio (what we actually sell) and go-to-market corpus play no part in the decision.
5. **No enforcement at write-time, and no uniform reach.** Alignment is (weakly) checked only on explicit `evaluate_org_business_decision` calls — not when an actor actually *commits* a consequential action (adds a product, commits a market/deal), and not for human actors.

## Target architecture

A decision/action is aligned by **criteria-extraction → multi-corpus dimensional alignment → specialist delegation → veto-on-hard-boundary → uniform write-time enforcement → amend-not-bypass → ledger**.

### 1. Criteria extraction
From the proposed statement/action, extract the salient criteria: **market/segment, product/offer, motion/GTM, geography, customer type**. (For "toasters to Alaskan fishermen from dock kiosks": segment=consumer/physical-retail, product=toasters/appliances, motion=kiosk retail, geo=Alaska.)

### 2. Multi-corpus dimensional alignment (the "right vectors")
Score the extracted criteria against **layered corpora**, each producing an independent alignment verdict:
- **Corporate WWWD stance** — mission, who we serve, how, what we sell. Market fit → *SMB/MSP?* No.
- **Product-portfolio inventory** — the catalog / DigitalProduct / Products we actually sell. Product fit → *is this in our portfolio or adjacent?* No.
- **Go-to-market corpus** — our motion (open-source + assurance + partner channel). Motion fit → *fits our GTM?* No.

Each corpus is owned by the role that maintains it; the alignment axes (mission/market/product/GTM fit) are added to the decision-axis registry alongside the operational axes.

### 3. Specialist delegation (A2A)
When the criteria touch a specialist-owned corpus, the overarching thread **delegates the precise check to the owner coworker** (e.g. the Digital Product Estate / Portfolio specialist for product-fit) via the coworker/A2A layer, and awaits its verdict. The specialist runs the exact check against its corpus and returns `{aligned | rejected, rationale, evidence}` to the caller.

### 4. Veto semantics
Any single corpus returning a **hard-boundary rejection is decisive** — it blocks. Alignment is **not** an average; a market/product/mission boundary can veto on its own. (The toaster earns a "resounding no" from all three independently.)

### 5. Uniform enforcement — a gate on every consequential tool call (all actors, owner included)
The gate is a **pre-execution interceptor on consequential tool use**, not a check that only runs on an explicit `evaluate_org_business_decision` call. Before a consequential tool executes, it is classified and gated. It runs three families of check (a tool call may trigger one or several):

| Check family | Question | Examples of gated tool calls |
|---|---|---|
| **Alignment** (this spec's core) | Does the action fit our mission / market / product / GTM? | add a product (`create_digital_product`), enter a market, launch a campaign |
| **Authority & policy** | Is this actor permitted; within spend/data/standing-stance limits? | pay a bill, issue a refund, grant access, change a config |
| **Consequence / HITL** | Reversible? Outward-facing? Needs human confirm? | email a client, send a quote, publish content, delete data |

- **Cheap classification first:** most tool calls are routine and clear instantly; only consequential classes incur the full check (so the gate is not a tax on every read).
- **No actor is exempt** — AI coworker, employee, or **the owner**. An owner-originated off-mission action still fires the gate and surfaces that it **contradicts the stated company direction**.
- **Federated / company-wide:** the same gate catches **human** actions — an employee's off-mission or out-of-policy move is caught by the coworkers checking the specifics against the mission-as-a-whole.

This unifies governance that is today scattered and inconsistent — tool grants (`TOOL_TO_GRANTS`), the coworker authority model, HITL tiers, standing stances, purchase/spend approval — under **one WWWD-grounded pre-tool decision point**, instead of each surface reinventing its own guard.

### 6. Amend, don't bypass
The **only** sanctioned way to enable a previously-off-mission action is to **deliberately amend the WWWD stance** (a visible governance act — "this changes our stated direction"). There is no bypass flag. This is what keeps the company from drifting off-mission by accident or by any single actor's command.

### 7. Reject-and-return + ledger
On alignment: transparent (the action proceeds). On rejection: **return to the originating caller** with the specific misalignment (which corpus, which criterion) so they can handle it — accept the block, or amend the stance. Every gate decision is recorded to the decision ledger (audit; the "keep humans in control of consequential automated decisions" stance).

## Collaboration shapes (Work Room) determine routing and role-inclusion per gate pattern

A gate decides *what* is checked and *whether it may proceed*; the **Work Room** decides *who* participates and *how they collaborate* to clear it. The two compose: **each gate pattern binds to a collaboration shape** — a reusable process/pattern over the Work Room substrate — that determines the routing and inclusion of human and non-human participants for that class of action.

**Grounding (extend, don't fork the Work Room):** a Work Room is a typed projection over a governed **Work Case** (WorkItem, TaskRun, AgentThread, `DecisionInteraction`, `Principal`, `AuthorityBinding`, presence, receipt). Participation is projected from Work Item human+coworker assignment and thread/task **lineage** (not an ad-hoc summon), resolved through `PrincipalAlias`, with AI sponsorship/authority from `Principal.sponsorPrincipalId` / `authorityMode`. Admission/action follow the monotonic ladder `none < discover < content < action`; sensitivity gates via `Principal.sensitivityClearance` with **step-up** for confidential/consequential. Rooms are **finite** (one bounded decision/action) or **standing** (ongoing activity); the result lands as an **Outcome Packet** and the gate verdict is a `DecisionInteraction` **receipt** on the case.

A gate fires **inside a Work Room** (spun up finite for the action, or the action already lives in a standing room). The bound shape determines:
- **Participants & roles** (human and AI): who is coordinator, who is the JSI-qualified specialist(s) applying WSID craft, who is the approver/owner, who is merely informed.
- **Routing order:** coordination → specialist check(s) → veto/approve → escalate-to-human on reject.
- **Inclusion rules:** which roles MUST be present/consulted (and at what authority level) before the action may reach `action` on the ladder; when step-up is required.

**Canonical shapes** (reusable, one per class of activity; extend, don't hardcode):

| Shape | Gate-pattern examples | Participants / routing |
|---|---|---|
| **Specialist-alignment** | add product, enter market, launch campaign | coordinator → JSI-qualified corpus specialist (WSID) → WWWD veto; escalate to owner on reject |
| **Approval / sign-off** | pay a bill, issue refund, spend over threshold | actor → finance specialist → approver (owner/authority) sign-off at `action` |
| **Outward-review** | email a client, send a quote, publish | actor → brand/marketing review → send-approval; step-up for confidential |
| **Change / consequential** | change config, delete data | actor → reviewer → confirm; higher HITL tier |
| **Escalation (on veto)** | any reject | route the misalignment back into the room to the originating caller + owner; resolve by accept-block or deliberate stance amendment |

Because participation, authority, sensitivity, and receipt are the room's, **human and non-human participants align to the shape identically** — a human employee's off-mission or out-of-policy action is caught in the same room, by the same shape, as an agent's. The gate machinery is constant; the **Work Room shape** is what routes the right people and coworkers into the right roles per activity, and the room's authority ladder + Outcome Packet + receipt make it governed and auditable.

**Composition, not new machinery:** this binds shapes over the existing Work Room projection (EP-2984B02B and the current Work Room comms consolidation, EP-WORKROOM-COMMS). No new room/membership/identity/channel model.

## Process ordering and preconditions — where business architecture syncs with systems architecture

Collaboration shapes are not just *who* and *what*; they are **ordered processes with preconditions**. Many activities have a required sequence that cannot be reversed:

> Employee onboarding must mint the **employee identity (employee ID)** before an **asset can be allocated** — because allocation *requires* the employee ID. The reverse order is not merely bad practice; it is impossible.

This ordering is not arbitrary. It is where **business architecture** (the value-stream / process sequence — *identity → assets → access*) **must stay coherent with application/systems architecture** (the data model: `Asset.employeeId` is a required FK to an existing `Employee`). The same dependency appears in both views:
- **Business view:** "you can't give someone a laptop before they're an employee."
- **Systems view:** the `Asset.employeeId` FK will not resolve until the `Employee` row exists.

So the gate carries a **fourth check family — precondition / ordering** — alongside the three from §5:

| Check family | Question |
|---|---|
| Alignment (WWWD × WSID) | Does this fit our mission / market / product / craft? |
| Authority & policy | Is this actor permitted; within limits? |
| Consequence / HITL | Reversible? outward-facing? needs human confirm? |
| **Precondition / ordering** | **Are the prerequisite states satisfied (the process-sequence dependencies)?** |

Preconditions are **derived from and validated against the synced business↔systems model** — the value-stream stage order (EA / FPAW stages) and the data-model constraints (Prisma FKs / state machines, mirrored into the EA data model). When the two are in sync, a single precondition ("employee ID exists") is *simultaneously* a business rule and a data invariant, and the gate enforces it once. When they drift, you get impossible processes or ungoverned workarounds — so the gate/Work Room is the **runtime point where business-process order and the systems model are kept coherent at the moment of action.** That coherence *is* the payoff of true business architecture.

Substrate: DPF already carries both halves — value streams + EA (`/ea`, archetype value streams, FPAW stages) and the Prisma data model mirrored into the EA data-model (`data-model-mirror` job, SysML projection). This gate binds them at execution time; it does **not** invent a new process/workflow engine.

## Existing substrate to extend (not rebuild)
- **WWWD corpus:** org WikiPages / stances (`/coworker-decisions/stance`).
- **Stance→dimension projection:** `principleDimensionVector`, `stance-dimension-map.ts` (BI-E1427A3E) — extend to `pageKind: stance` and to alignment axes.
- **Decision engine:** `evaluate_org_business_decision` / `principle_decide` / `option-recommendation.ts` — add alignment axes + veto + criteria-extraction.
- **Product portfolio:** DigitalProduct / business Products / catalog; **Digital Product Estate / Portfolio specialist** coworker owns the corpus.
- **Delegation:** `summon_coworker` / A2A coordination layer.
- **Enforcement points:** consequential write paths (product/catalog/opportunity creation).
- **Ledger + constitutional governance:** decision ledger; COO constitutional-governance remit.
- **Work Room collaboration substrate:** Work Case / Work Room projection, participation (`room-participation.ts`), authority ladder (`none<discover<content<action`), sensitivity/step-up, finite/standing rooms, Outcome Packet, receipts — EP-2984B02B / EP-WORKROOM-COMMS. The gate binds collaboration *shapes* over this; it adds no room/membership/identity model.
- **Business↔systems architecture:** value streams + EA (`/ea`, FPAW stages) and the Prisma data model mirrored into the EA data-model (`data-model-mirror` job, SysML projection) — the source of precondition/ordering rules the gate enforces.
- **Standards family:** TAK (control surface), GAID (identity/trace), TAK-JSI (specialist qualification) — `docs/architecture/agent-standards-family.md`.

## Acceptance
1. Toaster and a novel off-mission case (coffee-shop chain) → **decline**, with the rationale naming the failing corpus/criterion. On-mission (MSP partner, self-host support subscription) → **approve**. Off-mission scores materially lower than on-mission; a concrete option is selected (not null).
2. A specialist agent calling `create_digital_product` for an off-mission product is **blocked** at write-time and the caller is returned the misalignment.
3. An owner-originated off-mission action is blocked and surfaced as contradicting the stated stance; it proceeds **only** after the WWWD stance is amended.
4. Same enforcement observable for a human/employee-originated off-mission action.
5. Every gate decision recorded in the ledger.

## Non-goals
- Not a change to the local model or infra (capacity is fine; embeddings load on demand).
- Does not remove the safety escalation on genuine embedding-unavailability (keep the fail-safe from #4254).

## Composition with existing epics (extend, do not duplicate)

Substrate-verify first: much of this exists. This epic is the **integration + the missing alignment pieces**, not a rebuild.

| Concern | Owned / advanced by | This epic adds |
|---|---|---|
| Authority intersection + execute gate | **EP-31815F97** (TAK/GAID realization) | the WWWD×WSID **alignment** check-family + veto, at the same execution point |
| Work Room collaboration, Coordinator, GAID participants | **EP-WORKROOM-COMMS** | **shape binding** per gate pattern (routing / inclusion) |
| JSI weighting / specialist routing | **EP-DECISION-TIER-REBALANCE**, EP-E431FC8A (done) | specialist **delegation for alignment** verdicts |
| WWWD/WSID surface + altitude/context | **EP-0AF96937**, **EP-7B169558** | project stances into **alignment axes** + criteria-extraction |
| Harness mechanics as governed primitives | **EP-CLAUDE-INSIDE-OUT** | the gate **as a harness primitive** on tool use |
| Work graph (Case / Item / Capsule) | **EP-WORK-CONVERGENCE** | gate verdicts as Work Case receipts |

## Decomposition (execution slices)

1. **Alignment axes + stance→dimension projection** for `pageKind: stance` (extend BI-E1427A3E) — the "right vectors."
2. **Criteria-extraction + veto** semantics in `option-recommendation` — subsumes **BI-7E1F128A**.
3. **JSI specialist delegation** for corpus-fit verdicts via A2A (compose EP-DECISION-TIER-REBALANCE).
4. **Write-time TAK interception** on consequential tool calls (compose EP-31815F97 execute gate).
5. **Collaboration-shape binding** per gate pattern (compose EP-WORKROOM-COMMS).
6. **Precondition/ordering** check grounded in value-stream↔data-model (EA mirror).
7. **Embedding self-heal** — load-on-demand + back-fill skipped pages.
8. **Uniform enforcement for human actors** + amend-not-bypass override + GAID ledger receipt.
