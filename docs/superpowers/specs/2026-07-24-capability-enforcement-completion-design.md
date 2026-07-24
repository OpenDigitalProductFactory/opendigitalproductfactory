# Capability Enforcement Completion — make the archetype gate enforced, not just declared

**Date:** 2026-07-24
**Status:** Draft
**Area:** `apps/web/lib/storefront/` + `apps/web/lib/navigation/` + `apps/web/lib/coworker-lifecycle/` + `packages/storefront-templates/` + `scripts/` (CI guard)
**Decision surface:** `capability-enforcement-completion-design`
**Backlog:** extends [BI-66CF1AA4](#) (Phase 1b capability activation); files siblings BI-14FC40CC (coworker gating), BI-5CD43089 (CI consumer guard)
**Kernel decision:** `principle_decide` DI-5CC35CD9BEC0 — `spec-enforcement-completion` composite 18.87, margin 1.32 vs 0.2 tie threshold, high confidence, no commandment conflict (vs `ci-guard-first` 17.55, `coworker-gating-epic` 12.25, `fix-dead-setup-questions` 11.92).
**Related:** [`2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md`](2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md) (the applicability contract this completes), [`2026-07-21-archetype-provisioning-playbook-design.md`](2026-07-21-archetype-provisioning-playbook-design.md) (the four-dimension provisioning gate this adds a fifth check to).

## 1. Problem Statement

DPF has a well-designed capability-activation system. It is the platform's answer to "feature flags," and a better one than scattered booleans: 28 typed capability keys, applicability *derived* from eight operating-model axes (not hand-authored per archetype), a five-state applicability (`required`/`recommended`/`optional`/`hidden`/`not-applicable`) folded against a persisted per-org opt-in in a single read path so the setup wizard, the admin toggle, and route/UI gating cannot drift. The 2026-05-22 spec built this contract, and its own risk table names the failure it was designed to avoid: *"Feature flag sprawl — use a typed capability applicability profile, not scattered booleans."*

The contract is sound. **It is barely enforced.** A static sweep of branch `claude/feature-flags-modularity-d5725e` (2026-07-23) found:

| Surface | Gated | Total |
| --- | --- | --- |
| Pages calling `hasActiveOrgCapability` | 3 | 331 |
| API routes with any org-capability gate | 0 | 244 |
| Nav entries carrying `orgCapabilityKey` | 5 | ~70 |
| Coworkers with any archetype awareness | 0 | 67 |

Two grades of gap. **Six** capability keys have *no reference at all* outside the registry and the rules engine: `partner-program`, `storage-and-handling-billing`, `goods-custody`, `warehouse-operations`, `asset-pool`, `membership-eligibility`. A wider **eighteen** have no consumer via any *recognised gate mechanism* (nav `orgCapabilityKey`, a `hasActiveOrgCapability` guard, the customer-estate `getCapabilityActivation` policy, or a coworker binding) — the stricter, more honest definition the CI guard in §5.6 enforces. Two of the six declare a `setupPrompt` — so the setup wizard asks the operator *"Do you sell through partners or resellers?"* and *"Do you bill storage separately from handling?"* and the stored answers change nothing on any surface. That is not an unfinished feature; it is a question that misleads the user. (Note: a key counted "inert" by the recognised-gate definition may still be gated by a mechanism outside that set — e.g. a finance-templates flag — so the CI baseline is worded as "no consumer recognised by this guard," and its shrink-only ratchet makes an over-inclusive entry safe.)

The cost compounds with the product. At 22 archetypes, every capability added without a gate is surface added to all 22. This is the same class of drift #3476 fixed by making an unregistered quality-issue detector a compile error — retrofitting a bypassed writer is far more expensive than making the bypass impossible.

## 2. What Is Already Correct (Non-Goals)

These were verified as working and are explicitly **not** to be redesigned:

- **The single read path.** `resolveCapabilityActivation` / `resolveOrgCapabilityActivations` (`packages/storefront-templates/src/capability-activation.ts`) fold persisted choice over derived applicability; `getEffectiveCapabilityActivations` (`apps/web/lib/storefront/capability-activation.ts`) adds the risk-envelope auto-activation. One function, shared by wizard + admin + gating.
- **Mutual exclusivity.** Not modeled as an exclusion matrix and must not be — contradictory capability combinations are unexpressible because applicability derives from axes. An exclusion matrix over 28 keys would be 378 pairs to maintain.
- **Archetype co-existence.** `mergeActivationProfiles` (`packages/storefront-templates/src/composition.ts`) merges primary + secondary archetypes with monotonic union (strictest wins on `estateSeparation`, `customerGraph`, `billingReadinessMode`). Wired via `archetype-activation.ts` and `service-line-actions.ts`.
- **The reference implementation.** `member-equity` is the complete five-file pattern (registry entry → applicability rule → nav `orgCapabilityKey` → route guard → route-audience) and is the template every gap below replicates. The work is not to invent a mechanism; it is to walk the existing one across the surfaces that skipped it.

## 3. Design Goals

1. Every surface that a capability is *supposed* to gate is actually gated, resolving through the existing `getActiveOrgCapabilities` read path — no parallel mechanism.
2. No capability declares a `setupPrompt` without a live consumer (the honesty defect closes).
3. The coworker roster an org sees is filtered to its archetype — the highest-value, currently-zero surface.
4. A gated page is not defeated by an ungated API behind it.
5. The enforcement primitive lives in a surface-neutral home, not an archetype-family-named file.
6. Drift cannot re-grow: a declared-but-inert capability fails CI.

## 4. Non-Goals

- Redesigning the applicability derivation, the axes, or the merge (§2).
- Per-capability RBAC (that is the user-permission `capabilityKey` axis, orthogonal — see §5.1).
- True multi-tenancy for external customer portals (reserved by the 2026-05-22 spec §16).
- Adding release-flag / kill-switch machinery — see §9.

## 5. Architecture

### 5.1 Two axes, kept distinct

The nav model already carries two independent gates and this spec preserves the separation:

- **`capabilityKey`** (e.g. `view_finance`) — the *user-permission* axis (`CapabilityKey` from `@/lib/govern/permissions`): does this principal have the right to see it.
- **`orgCapabilityKey`** (e.g. `member-equity`) — the *archetype-activation* axis (a `@dpf/storefront-templates` `CapabilityKey`): does this org's business model include it.

An entry renders only when both pass. This spec touches only the second axis. The naming collision (both are called `CapabilityKey` in their own module) is real but out of scope; noted for the reader.

### 5.2 Rehome the enforcement primitive (Phase 0)

`getActiveOrgCapabilities` / `hasActiveOrgCapability` currently live in `apps/web/lib/storefront/civic-surfaces.server.ts` — named for the one archetype family (civic/governance) that first needed a route guard. Every future consumer that imports from a `civic-surfaces` file to gate a warehousing or partner surface inherits a lie about where the primitive belongs, and the next archetype will reasonably invent its own.

Move both functions to `apps/web/lib/storefront/org-capabilities.server.ts` (surface-neutral). Re-export from the old path for one release to avoid a big-bang import churn, then remove. This is a precondition for Phases 2–3 so new call sites import from the right home from day one.

### 5.3 Route/page gating parity (Phase 1)

The three existing guarded pages (`records-requests`, `member-equity`, `service-requests`) prove the pattern:

```ts
if (!(await hasActiveOrgCapability("member-equity"))) notFound();
```

Extend to the surfaces whose capabilities are declared but ungated. Each capability's `surfaces: [...]` field in the registry already names its pages — that is the worklist. Priority order by user-visible impact: the two `setupPrompt`-bearing capabilities first (`partner-program`, `storage-and-handling-billing`), because those close the honesty defect, then the remaining inert four.

### 5.4 API parity (Phase 1b)

A gated page with an open API is a soft gate: an agent or a direct fetch reaches the data the UI hides. For every route under `apps/web/app/api/**` that serves a gated surface, add the same `hasActiveOrgCapability` guard returning `404`/`403` before handler logic. The registry `surfaces` field plus the existing page guards give the mapping. This is the surface with the widest gap (0/244) and the lowest individual cost per route.

### 5.5 Coworker archetype gating (Phase 2 — BI-14FC40CC)

The largest gap and the one with the most user value for a small business. 67 agents, zero archetype filtering. Design decision to resolve at implementation (verify-substrate-first — the registry may already carry enough):

- `agent_registry.json` rows carry `value_stream`, `capability_domain`, `tier`. `tier: "orchestrator"` / `value_stream: "cross-cutting"` agents (e.g. `coo-orchestrator`) are foundational and must remain visible for **every** org — gating is additive, never subtractive of a foundational coworker.
- The archetype↔coworker association substrate already exists as recorded decisions in `scripts/archetype-coworker-decisions.txt` (`seeded:` / `extends:` / `new-planned:` per archetype) and `COWORKER_AGENT_SEEDS`. The gating axis should derive from that, not a new schema field, unless proven insufficient.
- Filter the summon / roster / coworker-offer surfaces through the same `getActiveOrgCapabilities` result so coworker gating and surface gating share one truth.

Acceptance: a salon org and an MSP org resolve different rosters from archetype alone; cross-cutting agents appear for both.

### 5.6 CI consumer guard (Phase 3 — BI-5CD43089)

A build-time check over `CAPABILITY_REGISTRY`: every key must have ≥1 recognised consumer — a nav `orgCapabilityKey`, a `hasActiveOrgCapability`/`getActiveOrgCapabilities` call site, the customer-estate `getCapabilityActivation` policy, or a coworker gating binding (§5.5). Fail the build on an inert capability.

- **Ratcheting baseline** for the pre-existing inert keys (precedent: `scripts/archetype-completeness-baseline.txt`), so the guard lands before every key is wired and ratchets toward zero. A *new* capability meets the floor (≥1 consumer) or fails — never parked in the baseline, same policy as the Archetype Completeness Guard.
- **Stronger assertion for prompts:** a capability declaring a `setupPrompt` must have a live consumer. The honesty defect is specifically prompt-without-enforcement, so it gets its own non-baselined check.

> **Implemented in this PR** (BI-5CD43089): `scripts/check-capability-consumers.mjs` + `scripts/capability-consumer-baseline.txt` (18 recognised-inert keys, 2 with unwired `setupPrompt`) + `scripts/check-capability-consumers.test.mjs` (9 cases) + the `Capability Consumer Guard` CI job. Phase 0 (§5.2 rehome to `org-capabilities.server.ts`) also landed. Phases 1/1b/2 (page + API guards, coworker gating) remain — coworker gating (BI-14FC40CC) is runtime-bound and blocked in a source-only worktree: `agent_registry.json` carries no archetype/capability affinity field and `archetype-coworker-decisions.txt` has ~1 real mapping, so the affinity data model + summon-UI wiring must land in a runtime-capable session rather than as dead code here.

## 6. Phasing

| Phase | Scope | BI | Size |
| --- | --- | --- | --- |
| 0 | Rehome primitive to `org-capabilities.server.ts` | BI-66CF1AA4 | small |
| 1 | Read-path wiring + page guards (setupPrompt keys first) | BI-66CF1AA4 | medium |
| 1b | API-route parity | BI-66CF1AA4 | medium |
| 2 | Coworker archetype gating | BI-14FC40CC | large |
| 3 | CI consumer guard + ratchet baseline | BI-5CD43089 | medium |

Phase 0→1→1b close the defect this thread surfaced (dead setup questions) and are the existing BI-66CF1AA4 scope made concrete. Phase 2 is the largest user win. Phase 3 makes the whole thing durable and should land last so it recognises the coworker binding as a consumer type.

## 7. Acceptance Criteria

1. Selecting an archetype whose axes do not derive `partner-program` hides every partner surface AND its API returns 404; selecting one that does, and answering the setup prompt "no," has the same effect via persisted choice.
2. No route in `apps/web/app/api/**` serving a gated surface returns data when `hasActiveOrgCapability` is false for that surface's capability.
3. A salon org's coworker roster and an MSP org's differ, derived from archetype; both include cross-cutting/orchestrator agents.
4. `getActiveOrgCapabilities` / `hasActiveOrgCapability` are importable from `apps/web/lib/storefront/org-capabilities.server.ts`; the civic file re-exports for one release.
5. CI fails when a capability key is added to `CAPABILITY_REGISTRY` with no consumer, and fails when a `setupPrompt`-bearing key has no consumer; the six current inert keys are in a ratchet baseline that only shrinks.
6. All four Build Gate checks pass (unit, prod build, UX verification on the canonical install, migration if any). No migration is expected — the persistence model (`OrganizationCapabilityActivation`) already exists.

## 8. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Rehome breaks imports | Re-export shim for one release; grep-verify call sites before removing. |
| API guard over-blocks a shared route | Gate on the *surface's* capability, not the archetype id; a route serving multiple surfaces gates on any-of, mirroring the nav `orgCapabilityKey` array semantics. |
| Coworker gating hides a foundational agent | Cross-cutting/orchestrator tier is never gated; acceptance test asserts it. |
| CI guard blocks a legitimately-staged capability | Ratchet baseline for pre-existing; a genuinely new-but-unwired capability is exactly what should fail — that is the point. |
| Scope creep into user-permission RBAC | §5.1 keeps the two axes distinct; this spec touches only `orgCapabilityKey`. |

## 9. Feature Flags vs Capability Activation (the framing this settles)

The originating question was whether to add feature flags. This spec is the answer: **do not.** The capability registry already provides *product entitlement* (this business does not do partner sales) — permanent, user-visible, derived. The other thing people call a "feature flag" is a *release flag / kill switch* (ship dark, roll back a bad feature) — temporal, deleted after rollout — and DPF already has a thin form of it: `PlatformConfig` key/value booleans read through `apps/web/lib/shared/feature-flags.ts` (`isUnifiedCoworkerEnabled`, `isStallWatchdogEnabled`). It needs fewer of those than a normal platform because of decisions already made correctly: one org per install, operator-gated self-upgrade, fail-closed migrations, and a rollback path mean a bad release's blast radius is one business that can roll back. So the guidance is: a *release* toggle → the existing `PlatformConfig` pattern; a *product-entitlement* toggle → register it as a capability, which this spec makes enforced rather than declared. Neither calls for a new flag framework.

The no-plugin-store trade is what makes this pay: a plugin store's real product value is not third-party code, it is *the ability to not ship something*. Build Studio removes the need to author externally; the capability registry supplies the hiding, without a plugin API, a compatibility contract, or a security boundary around foreign code. That trade only holds if the gate is enforced — which is this spec.

## 10. Recommended Next Slices

1. Phase 0 rehome (small, unblocks the rest, no behavior change).
2. Phase 1 on the two `setupPrompt` keys — closes the visible honesty defect fastest.
3. Phase 2 coworker gating — largest small-business value; own BI (BI-14FC40CC).
4. Phase 3 CI guard last, so it recognises all consumer types.
