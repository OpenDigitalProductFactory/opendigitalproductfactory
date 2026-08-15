# A2A Coordination Layer — Process Integration Within and Between Instances

**Date:** 2026-08-11
**Status:** Draft for architecture + UX-fit review; no implementation in this branch
**Builds on:** [Federated A2A Coordination with GAID](2026-08-08-federated-a2a-gaid-coordination-design.md) (#4124 — the deterministic trust spine) and `EP-A2A` (within-instance handoff/summon, shipped).
**Decision carried:** the AI-vs-code boundary sits at **coded spine · AI-reasoned fulfillment · human-gated consequences** (operator decision, 2026-08-11).
**Backlog (staged — file when the DPF MCP reconnects):** a coordination-layer epic under `EP-MSP-FEDERATION`, cross-referencing the A2A adoption program (`EP-E1F1DB58`), `EP-A2A`, and the demand-coordination sibling.

## 1. Problem — syncing is not coordinating

Federated demand now *replicates* faithfully (additions, changes, detail, withdrawals, in causal order). But replication is awareness, not integration: the two instances *see* each other's work; they do not yet *act on it together* — detect overlap, consolidate, delegate a task, or run a shared process. The step up from **sync** to **coordination** is where the platform gets powerful.

The obstacle is combinatorial: "how does a coworker on instance A fulfill an intent from instance B" spans every capability × process × data shape. Hand-coding each scenario is brittle and never finishes. So the architecture's central question is **not what to code — it is where to draw the line between the deterministic layer (code) and the reasoned layer (AI).**

## 2. The load-bearing boundary

Coordination is decomposed into three layers with a hard rule for which is which:

| Concern | Layer | Rule / why |
| --- | --- | --- |
| Identity, authority, replay protection, data-class boundaries, the A2A task/message envelope | **CODED (deterministic)** | Safety-critical and invariant. Must never be AI-improvised. This is the #4124 spine — reused verbatim, not re-opened. |
| Interpreting intent, mapping it to a local capability/coworker, planning fulfillment steps, translating one instance's process into another's | **AI-REASONED** | Open-ended and combinatorial. Enumerating it in code is the brittleness trap; a coworker reasons it within its authority. |
| Any consequential or irreversible action (executing a change, spend, external side effect, a cross-boundary write) | **HUMAN-GATED** | DPF autonomy-ceiling / HITL doctrine. The reasoned plan is a *proposal* until the coded gate + a human approve the consequential step. |

**The invariant:** AI reasoning may *plan and propose* anything, but it can only *cause an effect* through the coded spine, and a consequential effect only after a human gate. Cognitive load stays low (no scenario enumeration); safety stays high (the gate, not the enumeration, is what protects).

## 3. Within vs between instances — one model, two transports

The coordination layer is **transport-agnostic**: it reasons and proposes; execution rides an existing rail.

- **Within an instance:** the target is a local coworker; execution uses the shipped `EP-A2A` handoff/summon path and local TAK delegation (`collaboration-authority.ts`, `coworker-collaboration.ts`).
- **Between instances:** the target is a remote coworker; execution uses the #4124 federation A2A ingress (link auth + RFC 9421 signature + GAID binding + TAK resolution).

Same reasoning engine, same proposal/gate model, same receipts — only the execution rail and the trust checks differ. A within-instance coordination is a strict subset of the between-instance one (no device signature, no cross-org gate), so the design is specified once and the federation case adds the trust checks.

## 4. Sovereignty — coordinate by proposal, never by remote write

No instance may mutate another's records or command another's coworker directly. Coordination therefore produces **reasoned proposals + plans**; each sovereign install applies them to *its own* items/agents through *its own* coded authority and human gate. Cross-instance "consolidate these into one epic" is expressed as a proposal each side enacts locally (the originator merges/links its items; the peer does the same), and the existing demand sync then carries the net result. The AI reasons the synergy; the installs stay authoritative.

## 5. First concrete use case — demand coordination

The demand overlap the operator raised is the proving ground for the pattern:

1. **Detect** (AI-reasoned): a coordination pass compares demand across the mirrored set and surfaces overlaps/synergies (`this A-item ≈ that B-item`; `these 4 are one theme`). Seeds from the local `find_duplicate_candidates` / `sweep_duplicate_demand` machinery, lifted to reason across instances.
2. **Propose** (coded artifact): a consolidation proposal referencing canonical BI/GAID ids — merge set, epic grouping, retire list — with the reasoning and evidence attached.
3. **Apply** (coded + human-gated): each install enacts the proposal on its own items (merge/link/retire); consequential merges cross the human gate; the sync carries withdrawals/links onward.

This is the template every later coordination (task delegation, shared planning, cross-instance triage) instantiates.

## 6. Scalability (required review dimension)

- **No pairwise O(N²) coordination.** Cross-instance detection over a full mesh explodes; at fleet scale it must run through a **hub/aggregation** reasoning topology (the same hub the digest/topology epics name), not every-pair.
- **Bounded reasoning context.** An AI pass is never fed "the whole federation." It reasons over a **viewer-scoped, candidate-filtered** slice (deterministic pre-filtering picks the candidate set; AI reasons within it), so token/compute cost is bounded and independent of total fleet size.
- **Scale ceiling + epic.** This spec holds to *viewer-scoped, pre-filtered, hub-aggregated* coordination; fleet-wide streaming coordination is the deferred scale epic (shared with the digest delta-sync/hub work).

## 7. Data architecture / normal form (required review dimension)

- **No new authoritative record for identity or work.** The canonical homes stay: `BacklogItem`/`Epic` for work, `Principal`/`PrincipalAlias`/GAID for agents, `FederationLink`/`FederatedRecordMirror` for the relationship and mirrors. A coordination **proposal** is an artifact/plan that *references* those ids — it never duplicates or shadows them.
- **Decisions recorded once.** Every applied coordination action records through the existing decision-audit / receipt substrate (single source of truth), not a parallel log.
- **Reasoned plans are artifacts, not state.** The AI's plan is evidence attached to a proposal; the authoritative state change is the local coded mutation it triggers.

## 8. AI-reasoning guardrails

The reasoning coworker operates strictly within declarative bounds — TAK authority, data classes, and its autonomy ceiling (per JSI/TAK). It may read only what the link's projection contract and local policy permit; it may propose freely; it may cause effects only through the coded spine; consequential effects only after the human gate. Every coordinated action carries a receipt and its reasoning, so a coordination chain is auditable end to end.

## 9. Architecture review (advisory, inline)

- **Alignment: aligned.** Extends the #4124 spine and `EP-A2A` rather than forking; introduces no parallel identity, transport, or work table. The coordination layer is a reasoning + proposal engine over canonical substrate.
- **Escalate to kernel** (on MCP reconnect): (a) the exact human-gate threshold (which coordinated actions are "consequential"); (b) whether consolidation proposals are per-install-applied only, or a federated-epic primitive is introduced — a 2–4-option data-model decision.

## 10. UX-fit (advisory, inline)

- **Owning area:** Platform (Connections + the coworker/engagement surfaces). **Persona:** operator/founder.
- **AI boundary in the UI:** a proposal is *shown* with its reasoning and blast radius; enacting it is an explicit, previewed, human-confirmed action (never a click that silently triggers a cross-instance write). Reuses the `AgentWorkLauncher` preview/confirm pattern and the topology view (this spec) for provenance.
- **Evidence before merge:** measured ux-fit manifest per UI slice.

## 11. Decomposition (staged BIs — file via MCP on reconnect)

1. **Slice 1 — coordination proposal model + reasoning contract** (no UI, no transport): the typed proposal artifact (references canonical ids) + the reasoned-plan schema + the coded-spine/AI/human-gate interfaces. Pure, unit-tested. Ships first.
2. **Slice 2 — within-instance coordination** over `EP-A2A` (local delegation + demand consolidation proposal → local apply). Proves the model end-to-end without the federation trust checks.
3. **Slice 3 — between-instance coordination** over the #4124 ingress (adds device signature + GAID + cross-org gate). Same model, federation trust added.
4. **Slice 4 — demand coordination** (dedup/synergy detection → consolidation proposals → sovereign local apply → sync carries the result) as the first product instance.
5. **Slice 5 — federated epics** (pending the kernel decision in §9) — shared grouping spanning instances.

Each slice honors the boundary (coded spine, AI fulfillment, human-gated consequences) and the scalability/data-arch dimensions.

## 12. Acceptance criteria

- Identity, authority, replay, and data-boundary checks are 100% coded and unit-tested; no coordination path reaches an effect except through them.
- No AI-reasoned step causes a consequential/irreversible effect without a human gate; every coordinated action carries a receipt + its reasoning.
- Coordination is expressed as proposals applied by each sovereign install; no path performs a remote write into another instance.
- Within- and between-instance coordination share one reasoning + proposal model (the federation case adds only trust checks).
- Reasoning context is viewer-scoped and pre-filtered; no unbounded fleet-wide load; hub/aggregation path named for scale.
