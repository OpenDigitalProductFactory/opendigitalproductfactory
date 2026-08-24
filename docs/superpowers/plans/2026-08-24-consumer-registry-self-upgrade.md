---
status: active
---

# Consumer registry-channel self-upgrade implementation plan

**Backlog item:** BI-C3B0B2EA  
**Design:** `docs/superpowers/specs/2026-08-24-consumer-registry-self-upgrade-design.md`  
**Workroom:** WC-5F8A1DA1  
**Decision:** DI-1483263456A9 (`channel-to-immutable-candidate`, high confidence)  
**Branch:** `fix/make-consumer-docker-image-self-upgrade-authorit`

## Outcome

A source-free consumer install detects verification-gated GHCR channel movement, freezes it to a byte-verified immutable release candidate, and upgrades through the existing recovery/rollback lifecycle. The Upgrade Center renders one internally consistent status and action state.

## Backlog coverage

- Decision: atomic
- Parent: `BI-C3B0B2EA`
- Receipt: `blocked-by-BI-F0715C9C`
- Rationale: D1 discovery, D2 immutable acquisition, D3 publication identity, and D4 truthful operator projection must land together; any subset preserves either a byte-identity race or the reported false-current/no-op behavior.
- D1 registry candidate identity -> BI-C3B0B2EA.
- D2 resolver/orchestrator convergence -> BI-C3B0B2EA.
- D3 publication identity -> BI-C3B0B2EA.
- D4 truthful operator projection and measured verification -> BI-C3B0B2EA.
- Dependencies: existing release-mode promoter and consumer install-state contracts on `main`; live receipt issuance is blocked because BI-C3B0B2EA lacks the initiative scope baseline, tracked by BI-F0715C9C acceptance criterion 4.

| Key | Deliverable | Requirements | Verification | Depends on |
|---|---|---|---|---|
| D1 | OCI registry candidate reader and current-byte identity | R1–R8 | V1 focused reader/target tests | — |
| D2 | Shared action/queue resolver and immutable promoter handoff | R3–R5, R8, R10, R11 | V2 action/queue/promoter tests | D1 |
| D3 | Correct publication stamping and contract guard | R4, R6 | V3 workflow/Docker contract tests | D1 |
| D4 | Consistent Upgrade Center states and live evidence | R8, R9, R12 | V4 component/route/UX-fit/pregate | D1, D2 |

## Phase 1 — Red tests and registry identity

1. Add failing pure tests for OCI auth, response/digest validation, multi-arch selection, config labels, immutable-tag equality, bounded failures, and legacy unique/zero/ambiguous tag recovery. **[D1, V1]**
2. Add failing target tests proving config-digest equality means current even when the configured tag is mutable, while different bytes with a valid immutable candidate mean update available. **[D1, V1]**
3. Implement the server-only reader with injected fetch, strict host/size/time/page bounds, OCI digest verification, and stable failure reasons. **[D1]**
4. Refactor release target resolution around a single `RegistryReleaseCandidate` result consumed by page and queue. Remove GitHub release-run discovery from this path without changing release-health ownership. **[D1, D2]**

## Phase 2 — Immutable orchestration and publication

1. Add failing action/queue cases for newer/current/unavailable registry candidates, no Git calls, and exact tag/SHA/digest handoff into preflight and promotion. **[D2, V2]**
2. Read the current portal container config digest through a narrow injected Docker identity helper. Fail unavailable when byte identity cannot be established; do not silently fall back to tag equality. **[D1, D2]**
3. Converge page and queue on the same resolver input/output. Preserve the existing candidate promoter digest, quiescence, recovery point, migration, health, asset transaction, and rollback path. **[D2]**
4. Add failing workflow contract assertions, then stamp the validated gate tag into `DPF_PLATFORM_VERSION` and the OCI version label while retaining `github.sha` as revision. **[D3, V3]**
5. Retain promoter pre-swap revision checks and immutable release-tag validation. Carry the resolved portal config digest into the promoter and reject pulled bytes that differ before asset extraction or swap. **[D2, D3]**

## Phase 3 — Truthful Upgrade Center and bounded refactor

1. Add failing page/component tests for current, update available, registry unavailable, active, queued, and failed states. Assert current/unavailable states have no “Upgrade now” control and cannot render “Upgrade queued.” **[D4, V4]**
2. Replace independent summary/button booleans with one closed action-state projection derived from the owner summary. Keep the existing route/card/control and DPF tokens; add no new navigation or visual primitive. **[D4]**
3. Make registry failures actionable in plain language (“Update availability could not be verified”) while retaining technical reason/run evidence in the existing detail surface. **[D4]**
4. Refactor roughly one fifth of effort into separating registry I/O from pure candidate classification, centralizing release identity validation, and deleting the duplicate GitHub-target assumptions from action/queue UI paths. Do not broaden into unrelated release-health or promotion work. **[D1–D4]**

## Phase 4 — Verification and handoff

1. Run focused reader, target, action, queue, promoter, workflow-contract, owner-summary, page, and trigger-control suites after each green step. **[V1–V4]**
2. Run affected web typecheck, doc-index generation, prose/style guards, and `pnpm run pregate:preflight`. **[V4]**
3. Acquire the governed shared nonproduction lease. Verify `/ops/self-upgrade` in dark/light at desktop/narrow widths using controlled current, available, and unavailable fixtures; capture DOM and screenshots. **[V4]**
4. Write `docs/ux-fit/2026-08-24-consumer-registry-self-upgrade.ux-fit.json` with `sweep-measurement` evidence for the exact UI files. **[V4]**
5. Run architecture review, exact-tree merged-code CI, independent semantic review, DCO commit/PR gates, and record Workroom evidence. **[V4]**

## Stop conditions

- If GHCR does not return verifiable OCI manifest/config digests, stop before quiescence and surface unavailable.
- If more than one immutable release tag maps to a legacy channel digest, stop rather than choose by name/date.
- If the page and queue do not resolve the same candidate identity, do not ship.
- If candidate readiness and promotion cannot use the same frozen tag/SHA, return to design; never deploy mutable `latest`.
- If the shared nonproduction environment cannot be leased, record the blocker and do not claim live UX verification.
