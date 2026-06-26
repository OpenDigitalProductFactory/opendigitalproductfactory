# Convergent Governed RemoteAction Execution — Design

**Date:** 2026-06-25
**Status:** Draft (for founder review — gates the build)
**Author:** Claude (Opus 4.8) with founder direction
**Proposed epic:** `EP-REMOTE-ACTION` — *Governed Remote Execution: one primitive for federated remediation + estate patching*
**Converges:** `EP-MSP-FEDERATION` (federated remediation execution) · `EP-PATCH-MANAGEMENT` (estate patch apply) · `EP-CTRL-5E21A4` (relationship clarified, §11)

---

## 1. Why this exists

Two in-flight epics independently reached the **same missing primitive**: a governed way to *execute an approved action on a host the platform reaches through an Edge Node*, with proof.

- **EP-MSP-FEDERATION** closed the loop incident → diagnose → propose → **decide**, but an approved `FederatedRemediationProposal` currently stops at `executionEvidenceRef = "pending-control-runner"` ([federation-proposals.ts:73](apps/web/lib/actions/federation-proposals.ts)). Nothing runs.
- **EP-PATCH-MANAGEMENT** specced a generic `RemoteAction` model — *"generic on purpose. Patching is the first consumer; future inventory-on-demand, service restart, or controlled script execution can reuse it"* ([estate-patch-management-design.md §7.3](docs/superpowers/specs/2026-06-24-estate-patch-management-design.md)) — and the proposal-not-action MSP rule (§9.2) that **already names `EP-MSP-FEDERATION`** as the thing it must stay compatible with.

Building a federation-only executor now would duplicate `RemoteAction`. The decision this design records: **`RemoteAction` is the single governed execution primitive; federated remediation is a second consumer of it, not a second executor.** This is the DPF "converge, don't duplicate" discipline applied to the most security-sensitive surface in the platform — remote code execution on a customer's estate.

## 2. Substrate reality (grounded)

What exists today:

- **The band/decision kernel — shared, pure, done.** [remediation-authority.ts](apps/web/lib/service-desk/remediation-authority.ts): `REMEDIATION_RISK_CLASSES` (read-only < low < medium < high < destructive), `evaluateRemediationAuthority`, `buildRemediationProposal`, `authorityBandFromBinding`. Already used by both A4 (in-org) and B4 (cross-org). **No second approval engine is needed.**
- **The authority source.** `AuthorityBinding` (schema.prisma:2183 — `approvalMode` + `sensitivityCeiling`) → `authorityBandFromBinding` → an `AuthorityBand`. **Fail-closed** to `CONSERVATIVE_AUTHORITY_BAND` (only read-only auto-approves).
- **The change-audit anchor.** `ChangeRequest` (schema.prisma:755) — mutating actions hang off it.
- **The cross-org proposal.** `FederatedRemediationProposal` (schema.prisma:10652) — `actions` Json (RemediationActionDraft[] + per-action decision), `status: proposed|approved|rejected|executed|expired`, `executedAt`, `executionEvidenceRef`.
- **`RemoteAction` itself: specced, not built.** The patch spec §7.3 defines the model; **no `RemoteAction` model exists in the schema yet** (verified).

What is **zero** today — and is the security crux:

- **No platform → Edge Node dispatch channel.** Every `/api/v1/edge/*` route is the Edge pushing *up* (enroll, heartbeat, discovery-runs, events, metrics) or pulling config (adapters). There is no downward action dispatch, no `action:dispatch` / `action:report` token scope, no `capability.action.execute`. The Edge is **outbound/pull-only** ([edge-node-types.ts](packages/db/src/edge-node-types.ts): `mcp.gateway`/`a2a.gateway`/`policy.enforcement` are *reserved* names, not implemented).

**Consequence:** the *record + governance + seam* is buildable safely now; the *actual execution* requires opening an Edge dispatch channel, which the patch spec §8 already gates behind machine-bound trust + a threat model. That gate is real and stays shut until §7 of this doc is satisfied.

## 3. The shared primitive — adopt `RemoteAction` (patch §7.3)

We adopt the patch spec's `RemoteAction` verbatim as the convergent primitive (one migration, owned by `EP-REMOTE-ACTION`, consumed by both epics). Salient fields: `actionType` (`inventory.collect | diagnostics.collect | patch.apply | service.restart | reboot | script.run`), `parameters`, `requestedByPrincipalId`, `approvalState` (`proposed|approved|rejected|cancelled`), `approvedByPrincipalId`, `changeRequestId`, `deploymentWindowId`, `customerAccountId`/`customerSiteId` (tenant isolation), `status` (`queued|dispatched|running|succeeded|failed|rolled-back|timed-out`), `result`, `evidence`, `rollbackOf`.

Two convergence additions to the patch shape:

1. **`originProposalRef String?`** — back-reference to the `FederatedRemediationProposal` (or in-org `AgentActionProposal`) that produced this action, so evidence flows back to the proposal that the customer decided on.
2. **`originLinkId String?`** — the `FederationLink` an MSP-originated action came across, so the §6 sovereignty rule ("MSP-originated actions never leave `proposed` autonomously") is enforceable at the row.

## 4. The federation seam (the novel part — replaces `pending-control-runner`)

Today's stub becomes a real materialization, **on the customer's side, under the customer's authority**:

```
FederatedRemediationProposal (customer side, status=approved)
   └─ for each dispatchable action (decision ≠ refuse):
        materialize a RemoteAction on the CUSTOMER's estate
          actionType   ← vocabulary map (§5)
          originProposalRef ← proposal.proposalId
          originLinkId      ← proposal.federationLinkId
          requestedByPrincipalId ← the federated-peer (MSP) principal
          approvalState ←
              auto-approve   → "approved"   (band permits, within the customer's binding)
              needs-human    → "proposed"   (waits for the customer's per-action approval)
        evidenceRef on the proposal ← rollup ref over the RemoteAction(s)
   └─ when every RemoteAction reaches a terminal status, proposal.status → "executed"
```

The §9.2 rule is enforced structurally: an action with `originLinkId != null` **may not transition past `proposed` without a customer-side `approvedByPrincipalId`** — the MSP cannot self-approve across the link. (Schema-level guard + the dispatcher refuses it.)

## 5. Action-vocabulary reconciliation

The A4 diagnosis emits its own verbs ([remediation-suggestions.ts](apps/web/lib/service-desk/remediation-suggestions.ts)); they map onto `RemoteAction.actionType` + risk:

| A4 actionType | RemoteAction.actionType | riskClass | class |
| --- | --- | --- | --- |
| `collect-*-diagnostics`, `collect-*` | `diagnostics.collect` / `inventory.collect` | read-only | **safe** |
| `restart-service`, `restart-interface` | `service.restart` | medium | gated |
| `rotate-certificate` | `service.restart`-class (cert) | low | gated |
| (patch consumer) | `patch.apply`, `reboot` | high | gated |

The **read-only class is the only one that can auto-approve** under the conservative band — and even it executes only once the Edge dispatch channel (§7) is open. `script.run` stays out of scope (patch §7.3) until its own threat model.

## 6. Reuse, not reinvention

- **Decision:** `buildRemediationProposal` / `evaluateRemediationAuthority` / `authorityBandFromBinding` — unchanged, called before any dispatch. The band is resolved from the customer's `AuthorityBinding`; absent one, conservative (read-only only).
- **Audit:** mutating `RemoteAction`s require a `ChangeRequest`; reboots/applies require a `DeploymentWindow`.
- **No new proposal/approval engine, no new identity table** (federated-peer/operator are `PrincipalAlias`es already, AGENTS.md §11).

## 7. Security model — the gated part (do not build blind)

Executing a mutating `RemoteAction` on a customer host is the highest-stakes capability in DPF. The patch spec §8 prerequisites are adopted **as hard gates**, and remote mutation stays unbuilt until all are met and the founder signs off:

1. `capability.action.execute` disabled by default; **action-type allow-listed per node** (`inventory.collect` can be on while `patch.apply` is off).
2. Split token scopes: `action:dispatch` (delivery) + `action:report` (results).
3. **Machine-bound Edge trust (mTLS / DPoP / attested key)** — bearer-token-only nodes may *collect* but never *mutate*.
4. Mutating action ⇒ capability + scope + policy approval + `ChangeRequest` + valid maintenance window, no blackout.
5. Rollback-impossible actions must declare it before approval and store compensating evidence; reboot is a first-class action, never a side effect.
6. **A focused threat model runs before any P2 execution work** — command injection, package-manager abuse, token theft/replay, confused-deputy across customer scope, downgrade, rollback failure, malicious/compromised Edge reporting.

## 8. Phasing

- **P1 — Governance + record + seam (safe, migration-light, no remote mutation).** Add `RemoteAction`; materialize it from an approved proposal (§4) with consent re-check; record evidence; replace `pending-control-runner` with real `RemoteAction` refs. Read-only/diagnostic actions reach `approved`; mutating actions reach `proposed` and **stop** (no dispatch channel exists, so nothing runs — the record is honest, the boundary explicit). Pure libs + tests. *This is the safe slice I can build immediately on your go.*
- **P2 — Edge dispatch channel (GATED on §7 + founder sign-off).** `action:dispatch`/`action:report` scopes, machine-bound trust, the downward dispatch + result-ingest routes, threat model. This is where execution becomes real — and where it must not be rushed.
- **P3 — Mutating backends.** Native package managers (patch), `service.restart` (federation), reboot policy — each behind P2 + per-action allow-list.

## 9. What I am NOT proposing to do autonomously

Build P2/P3 (anything that actually dispatches to or mutates a host) without (a) the threat model, (b) machine-bound Edge trust, and (c) your explicit go. The design deliberately makes P1 valuable on its own (the proposal→execution lifecycle becomes real and auditable) while the dangerous capability stays gated.

## 10. Open decisions for the founder

1. **Epic shape:** new `EP-REMOTE-ACTION` owning the shared primitive (recommended), vs. landing `RemoteAction` under EP-PATCH-MANAGEMENT and having federation consume it.
2. **Authority bands (§15.4 carryover):** the conservative default means *nothing auto-executes* across a federation link. Setting per-agreement bands is what lets even read-only diagnostics auto-run. Still your call.
3. **P1 now?** Whether I build the safe P1 governance+record+seam slice next, or hold the whole epic for Build Studio.

## 11. Relationship to EP-CTRL-5E21A4

`EP-CTRL-5E21A4` ("Automated Control Utility") is **desktop/interactive control** — driving a Windows desktop for install/QA and supervised remote assist. It is a *different executor* (interactive desktop) from `RemoteAction` (headless, governed, Edge-mediated host actions). The `"pending-control-runner"` stub was named loosely; the correct home for federated **remediation** execution is `RemoteAction`, not the desktop utility. The two may later share the governed-action lifecycle vocabulary, but they target different surfaces and should not be merged.
