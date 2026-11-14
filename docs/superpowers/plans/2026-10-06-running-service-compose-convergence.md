---
status: active
---

# Plan: self-upgrade converges running services to the shipped compose config

- Backlog item: BI-C54E691E
- Spec: [2026-10-06-running-service-compose-convergence-design.md](../specs/2026-10-06-running-service-compose-convergence-design.md)
- Decision: DI-C0BF4CF3A173
- Date: 2026-10-06

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Acceptance (BI-C54E691E)

- AC-1 (OBJ-CHAIN): On an install whose TLS overlays came from bootstrap-organization-pki, the promoter's chain includes organization-trust.yml and tls.yml, from the same resolver the start path uses.
- AC-2 (OBJ-CONVERGE): A self-upgrade that changes portal-tls's compose config recreates it. Live: Init=true, and service-converge-outcome.json lists it as recreated.
- AC-3 (OBJ-STATEFUL): An unchanged postgres keeps its container id through a self-upgrade. A changed one is recreated before the portal swap. A failed health check aborts before the swap.
- AC-4 (OBJ-CONVERGE): A stopped service stays stopped, and an inspection failure never recreates a container.
- AC-5 (OBJ-HONEST-GATE): The convergence gate refuses `auto-converges` for a service no resolved chain contains. Every shipped compose service has a catalog recreateClass.

## Traceability

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| D1 compose-chain resolver | OBJ-CHAIN | `resolveComposeChain`, `scripts/lib/compose-chain.mjs`, `compose.sh`, `release-target.ts`, `bootstrap-organization-pki.sh`, `activation-overlays.txt` | install, start and self-upgrade render one chain | AC-1 |
| D2 catalog recreate class | OBJ-STATEFUL, OBJ-HONEST-GATE | `recreateClass`, `capability-service-catalog.generated.json`, `dpf.recreate-class` | catalog generation and contract test | AC-5 |
| D3 sidecar converge (step 7e) | OBJ-CONVERGE | `promote.sh` step 7e, `service-converge-outcome.json` | self-upgrade step 7e sidecar-converge | AC-2, AC-4 |
| D4 data-owner converge (step 3c) | OBJ-STATEFUL | `promote.sh` step 3c | self-upgrade step 3c data-owner-converge | AC-3 |
| D5 checkable convergence gate | OBJ-HONEST-GATE | `convergence-surfaces.json`, `check-convergence-impact` | PR convergence gate | AC-5 |

## D1 (BI-B422ED03): one activation table for the compose chain (AC-1)

- **Change, as built:**
  - `scripts/installer/lib/activation-overlays.txt` holds the marker-to-overlay rule.
  - `compose.sh` reads it.
  - `promote.sh` appends marker-activated overlays from the target tree's table to the recorded chain.
  - Release assets ship the table.
  - `compose-chain.ps1` is pinned to the table by a parity test.
- **Tests first:** `scripts/promote-compose-activation-overlays.test.mjs` covers TLS enabled after install, both markers in table order, no marker or one not set to `1`, an overlay already recorded, a target without the table or the overlay file, and the release-assets copy. It runs in the self-upgrade acceptance workflow.
- **Ships alone:** yes. `portal-tls` becomes visible to the promoter's chain (and so to step 7d and, later, step 7e).

## D2 (BI-22A2CA0D): per-service recreate class (AC-5, part)

- **Change (amended by WWMD `DI-3A94F2D28550`):** every service declares `labels: dpf.recreate-class: stateless|data-owner|managed` in the compose file that defines it, overlay services included. The shared compose parser in `check-capability-compose-profiles.mjs` learns labels and block-list profiles. A new guard, `scripts/check-no-unclassified-compose-services.mjs`, fails on a service with a missing, unknown or conflicting class.
- **Tests first:** the guard's own tests, plus the guard run on main, which reports 31 unclassified services.
- **Ships alone:** yes. The labels are metadata: nothing reads them until D3 and D4. Portal and sandbox pick them up on their existing force-recreate.
- **Note for D3/D4:** adding the labels changes every service's config hash, so the first upgrade with D3/D4 recreates each service once, including one postgres restart in step 3c.

## D3 (BI-00F7D2E3): step 7e sidecar-converge (AC-2, AC-4) — depends on D1, D2

- **Shipped first in shadow mode** (WWMD `DI-C04ABC76BBF4`).
  - After 7d, the step compares each running service's `com.docker.compose.config-hash` label with `docker compose config --hash` rendered with 7d's daemon-path override.
  - It records `wouldRecreate`, `unchanged`, `skippedStopped`, `dataOwnerChanged`, `unclassified` and `failed` in `service-converge-outcome.json`.
  - It recreates nothing and never fails the run. It also runs under `--dry-run`.
- **Why shadow:** on 2026-10-06 a host render of the live chain matched `portal-tls` and `postgres` but differed for `portal`, `loki`, `alloy`, `inngest` and `redis`, none of which had an intended change. Enforcing at once risked recreating those every upgrade. The shadow report from one live upgrade decides whether the promoter's render is stable.
- **Then enforce:** a follow-up makes stateless `wouldRecreate` entries run `up -d --no-deps <svc>` with the same arguments, with health checks, stopped services left stopped, and fail-loud-not-abort.
- **Tests first:** `scripts/promote-sidecar-converge.test.mjs`. A fake `docker` serves the rendered config, the hashes and the container list. The test proves the outcome classification and that no `up`, `rm` or `--force-recreate` call is made.

## D4 (BI-7F2709F9): step 3c data-owner-converge (AC-3) — depends on D2

- **Change:**
  - After 3a and before 3b and the swap, for each running `data-owner` whose hash differs, recreate it and wait for health.
  - A failure aborts the promotion before the swap, and the recovery point restores the install.
  - Fold `_recreate_pg_onto_pgvector` into this step.
- **Tests first:** the harness checks that `postgres` keeps the same container id when unchanged, is recreated before the portal swap when changed, and aborts before the swap on a failed health check.

## D5 (BI-205A85C0): checkable convergence gate (AC-5) — depends on D1, D2

- **Change:** the `compose` surface checks the services a PR changes. `auto-converges` is valid only when each changed service is in a resolvable chain and has a `recreateClass`. Otherwise the gate refuses with the reason.
- **Tests first:** the fixtures include #6020's shape, a `portal-tls` change before D1/D2. It is refused before and accepted after.

## Risks and rollback

- **Recreating a stateful service mid-upgrade:** D4 confines it to a changed hash, before the swap and behind the recovery point. Unchanged data-owners are never touched (AC-3).
- **Over-eager recreation from a non-deterministic render:** the hash comes from compose itself. Proven live: `config --hash portal-tls` equals the container label.
- **Rollback:** each deliverable is its own PR and reverts cleanly. D3 and D4 only add steps; reverting restores today's behaviour.

## Backlog coverage

Decomposed. Umbrella BI-C54E691E.

| Deliverable | Backlog item | Depends on |
|---|---|---|
| D1 | BI-B422ED03 | — |
| D2 | BI-22A2CA0D | — |
| D3 | BI-00F7D2E3 | D1, D2 |
| D4 | BI-7F2709F9 | D2 |
| D5 | BI-205A85C0 | D1, D2 |

## D6 follow-up: selected service-image identity (BI-0282088D)

The November 13 source assessment and decision DI-CAC49D437EA8 extend the
existing spec's OBJ-IMAGE. This is a distinct image-provenance contract, not
delivery of the remaining D4/D5 work or permission to enforce shadow step 7e.
The existing D1-D5 mappings above remain intact. The parent coverage was renewed
without changing its original criteria. The child has its own immutable coverage
`cmwfow6zm0sqe0eqcd4nshyae` and implementation admission `IRD-D2A0E98FB7C3`.

| Deliverable | Objectives | Contracts | Flow | Acceptance |
|---|---|---|---|---|
| D6 qualified service-image plan | OBJ-IMAGE | `RuntimeTransitionEnvelope`, `RuntimeTransitionReceipt`, `scripts/apply-runtime-capability-transition.mjs`, `runtime-capability-executor.ts`, packaged protocol probe | native preview, signed image preparation, apply, health, journal replay and compensation | AC-I1, AC-I2, AC-I3, AC-I4, AC-I5, AC-I6, AC-I7 |

| Deliverable | Backlog item | Depends on |
|---|---|---|
| D6 | BI-0282088D | D1, D2 |

D6's phases below are internal sequencing for one image qualification contract.
An isolated serializer, image build or green health check cannot independently
deliver it. Source implementation is in progress; served acceptance remains unrun.

### D6 acceptance (quoted from BI-0282088D)

- AC-I1: Desired service images are server-derived from immutable canonical source/release evidence; labels or portal SHA alone never qualify them.
- AC-I2: A selected build-only stateless service has bounded native preparation with exact input/image proof and no implicit build of unrelated required services. Missing or unsupported proof holds before runtime mutation.
- AC-I3: Actual post-apply image IDs and existing health checks must match the signed plan before applied is recorded.
- AC-I4: Crash replay and compensation preserve/recover the exact prior qualified image IDs; uncertain ownership or settlement remains unverified.
- AC-I5: No stateful/managed restart, stopped-service activation, volume removal, grant/policy expansion or shadow-mode enforcement is introduced by this slice.
- AC-I6: Source/consumer and platform differences use existing runtime contracts. Old or unsupported packaged protocols fail closed before host effects, including N-1 promoter staging.
- AC-I7: Affected production-owner tests, normal gates/independent review, governed served workflow/failure recovery and exact cleanup supply separate truthful evidence; no fixture is production acceptance.

### D6 sequence

1. Reconcile the parent's legacy coverage, D4/D5 statuses and the new child.
   Quote AC-I1 through AC-I7 verbatim from its live body in its immutable
   implementation coverage. Confirm the owning funding and scope; do not treat
   the pending item attribution as approval. Claim exact code paths, read their
   impact contract, and resolve related tests before Red.
2. Extend the existing signed native plan/probe/receipt contract. Keep new
   critical logic within its verified packaged closure, or separately deliver
   compatibility first. Tests must fail for unsupported protocol, altered plan,
   wrong source, caller paths/hashes and N-1 missing inputs before host effects.
3. Reuse canonical artifact preparation for a bounded selected stateless image.
   Exercise source and published-image install modes. Stage immutable inputs,
   qualify the resulting actual image ID, and pin it for apply. Test that no
   unrelated service is built and unqualified contexts never reach runtime.
4. Extend existing journal/replay/compensation and health verification with the
   exact prior and intended images. Test interruptions at each durable phase,
   moved tags, missing prior images, unhealthy service, ownership loss and
   uncertain settlement. Retain failed recovery rather than declare success.
5. Preserve managed/data-owner/stopped-service, volume, activation and explicit
   shadow controls. Test each boundary against the real production owners with
   injected Docker/process adapters, without production runtime mutation.
6. Run the affected protocol, actuator, coordinator, executor and promoter
   closure tests, package typechecks, and the exact current gate-context guards.
   Use normal exact-tree qualification, independent review and protected
   `pnpm land`. No new provider, budget or access is implied by a phase change.
7. Under an admitted isolated runtime, exercise native preview/apply, saved
   proof reload, missing/unsupported inputs, actual image mismatch and bounded
   recovery. Record fixtures as simulated, prove exact cleanup, and preserve
   infrastructure failures as inconclusive. A live install advance remains the
   coordinator's action; final native image and owner-workflow proof must name
   actual deployed bytes. Do not substitute a client-built image.

Expected existing seams: `apps/web/lib/platform-runtime/transition-protocol.ts`,
`transition-coordinator.ts`, `runtime-capability-executor.ts`,
`scripts/lib/transition-signing.mjs`,
`scripts/apply-runtime-capability-transition.mjs` and their colocated tests.
Image-proof and minimal promoter-context owners must be checked before any
closure change. The implementation path set remains provisional until admission.

Rollback is through protected source delivery and the existing qualified-image
compensation path. An uncertain prior image or ownership check stops recovery;
it does not authorize a blind rebuild, volume change or wider service restart.

### D6 implementation checkpoint

The v3 plan, existing artifact owner, selected-only actuator, authenticated
compensation and native administrator selector are implemented in the child
Workroom WC-876B044A. Source fixtures exercise published/source inputs,
unsupported protocols, unchanged-state boundaries, exact image and resource
proof, health rollback, crash replay and uncertain settlement. They use injected
IO and are separate from production acceptance. The original funding envelope
remains pending; no new funding, provider or grant is inferred.

Before completion, freeze the exact tree, run its required source/runtime gates,
obtain independent code review, deliver through protected `pnpm land`, then use
an admitted served target for native preview/apply, saved results, holds and
recovery. The coordinator alone advances the canonical install. Preserve the
original D4/D5 unfinished status and step 7e shadow mode throughout.
