# Threat model — Edge Node remote execution for patch management (P2 gate)

- **Date:** 2026-06-25
- **Status:** Gate artifact. Authored ahead of any P2 execution code (BI-869AFB8C). **No mutating `RemoteAction` capability may ship until the mitigations here are designed in and this model is reviewed.**
- **Scope:** the *not-yet-built* governed remote-execution capability (`RemoteAction`, `capability.action.execute`, token scopes `action:dispatch` / `action:report`) from `2026-06-24-estate-patch-management-design.md` §6.3, §7, §8. The read-only P0 posture pipeline (inventory → OSV/KEV → findings → `/ops/patches`) is **out of scope** — it performs no execution and writes only `AssuranceFinding` rows.
- **Gates:** BI-147AAC04 (RemoteAction primitive). **This document is the binding prerequisite.**

---

## 1. Why this exists

Patch *posture* (read-only) is safe — it observes. Patch *apply* is the opposite: it runs privileged code on hosts DPF does not own, across a customer boundary, unattended. Commodity RMM tools treat this as "run a script with a label"; DPF must not. The design already mandates a threat model before P2 (§8). This is that model: the asset/boundary map, the attack surface, and the concrete invariants P2 must satisfy.

The Phase-0 Edge Node token is a **per-node bearer, not machine-bound** (Edge Node spec §"Phase 0 token-binding posture"). That is acceptable for *collecting* posture. It is **not** acceptable for *mutating* a host. The single most important output of this model is the minimum trust posture (§5) that must land before `patch.apply` is allowed.

---

## 2. Assets and trust boundaries

| Asset | Why it matters |
| --- | --- |
| The target host (customer machine) | Remote code execution here = full compromise of a customer asset. Highest-value asset. |
| The Edge Node node token (`dpfedge_*`) | Bearer credential; theft = impersonate the node, receive its dispatched actions. |
| The Authority Core dispatch path | If an attacker can inject a `RemoteAction` or move one to `approved`, they command the fleet. |
| The patch payload / package source | A poisoned package or downgrade applied at scale is a supply-chain attack. |
| The customer↔MSP boundary | Crossing it without consent breaks sovereignty (EP-ESTATE-SOVEREIGNTY) and trust. |
| Result/evidence records | Forged "succeeded" evidence hides a failed or malicious change. |

**Trust boundaries crossed by one `patch.apply`:** Authority Core → (network) → Edge Node → (OS privilege) → package manager → target host; and, in the federated topology, MSP DPF → (FederationLink) → customer DPF. Every arrow is an attack surface.

---

## 3. Threats and mitigations

Each threat maps to concrete `RemoteAction` gate checks and Edge Node hardening. "Gate" = a precondition the Authority Core enforces before dispatch; "Node" = a control on the Edge Node.

### T1 — Command injection via action parameters
A crafted `parameters` (package name, version, target) escapes into a shell and runs arbitrary code.
- **Mitigations:** never build shell strings — Node invokes package managers via argument vectors (`execFile`-style, no shell), with an **allow-list of binaries** (`winget`/`apt`/`dnf`/`brew`/WUA) and a typed parameter schema validated at both dispatch and Node. No `script.run` until a separate, stricter model (§6). Reject any parameter containing shell metacharacters. (Never-trust-input commandment.)

### T2 — Stolen / replayed node token
A leaked `dpfedge_*` bearer lets an attacker impersonate the node and receive (or forge) actions.
- **Mitigations:** **machine-bound trust (§5)** — a bearer alone cannot run mutating actions. Per-action nonce + short expiry + idempotency key so a captured dispatch cannot be replayed. Token in OS secure store, never on disk in cleartext. Heartbeat-driven rotation already exists; mutating capability additionally requires the bound key.

### T3 — Confused deputy across customer scope
An action scoped to customer A is executed against customer B's hosts (or an MSP-originated action runs in a customer boundary).
- **Mitigations:** every `RemoteAction` carries `customerAccountId`/`customerSiteId`; the Node only accepts actions whose scope matches its own enrolled scope (checked Node-side, not just trusted from the envelope). **Cross-customer dispatch is rejected** (acceptance §4 of the design). In the federated topology, an MSP-originated action can reach at most `proposed`; only a **customer principal** moves it to `approved` (proposal-not-action, §8 of the design).

### T4 — Unauthorized dispatch / approval-state forgery
An attacker injects a `RemoteAction` or flips `approvalState` to `approved` to command hosts.
- **Mitigations:** `action:dispatch` is a distinct, narrowly-granted scope; `approvalState` transitions are authority-gated and audited; every mutating action requires a linked `ChangeRequest` (mirrors the self-upgrade pattern). Capability is **off by default** with a per-`actionType` allow-list (a node may be allowed `inventory.collect` but not `patch.apply`).

### T5 — Package-manager abuse / malicious source
The action points the manager at an attacker-controlled feed, or installs an arbitrary package.
- **Mitigations:** managers use their **default, signed** sources only (config pinned Node-side); the target is constrained to a known `SoftwareProduct`/advisory remediation, not a free-form package; honor each platform's signature verification. No third-party source injection via parameters.

### T6 — Downgrade attack
An action installs an *older*, known-vulnerable version under the guise of a "patch."
- **Mitigations:** the dispatch validates `targetVersion >= installedVersion` (the version comparator already exists in `patch-intel`), and that the target resolves a known advisory or is the vendor-current version. A downgrade requires explicit, separately-approved intent.

### T7 — Rollback failure / bad patch deployed broadly
A patch breaks the host and cannot be undone, or a bad patch is rolled out fleet-wide.
- **Mitigations:** recovery point **before** mutation where the host is DPF-managed; **health-check after**, **auto-rollback** on failure (reuse the self-upgrade recovery/rollback path). Where rollback is impossible, the action must say so **before** approval and store compensating evidence. Staged rollout (canary → rolling) so a bad patch is caught on a small set first (PatchPlan, P3). Reboot is a **first-class, policy-gated, windowed** action, never a side effect.

### T8 — Malicious / compromised Edge Node forges results
A compromised node reports "succeeded" to hide a failed or hostile change, or floods events.
- **Mitigations:** result evidence must include before/intended/post version, backend, exit status, and health-check outcome — cross-checked against the next discovery sweep (a node claiming success whose inventory still shows the old version is flagged). Rate limits on result submission. A node in `quarantined` trust state cannot run mutating actions. Defense-in-depth: the Authority Core treats node-reported success as a claim to be verified, not ground truth.

### T9 — Denial of service via action storms
An attacker (or a buggy plan) dispatches a flood of reboots/patches, taking the estate down.
- **Mitigations:** mutating actions are gated by `DeploymentWindow` + `BlackoutPeriod` and quiescence; PatchPolicy bounds concurrency; the kernel governs the *action* (reversibility/blast-radius/disruption), not the verdict.

---

## 4. STRIDE coverage summary

| Category | Covered by |
| --- | --- |
| Spoofing | T2 (machine-bound trust), T4 (scoped grants) |
| Tampering | T1, T5, T6 (typed params, signed sources, no-downgrade) |
| Repudiation | ChangeRequest mirror + immutable evidence (T8) |
| Information disclosure | scope isolation (T3), least-privilege grants |
| Denial of service | T9 (windows/blackout/quiescence/concurrency) |
| Elevation of privilege | T1, T2, T4 (no shell, bound key, off-by-default allow-list) |

---

## 5. Minimum machine-bound trust posture for P2 (the open question)

Resolves design §13 Q4. **`patch.apply` (and any mutating `actionType`) requires the Edge Node to authenticate with a machine-bound key, not a bearer token.** Acceptable mechanisms, in preferred order:

1. **mTLS** with a per-node client certificate whose private key is generated in, and non-exportable from, the host secure element / OS keystore (TPM / Secure Enclave / platform key).
2. **DPoP** (or equivalent proof-of-possession) binding each dispatch/report to a key held in the secure store.
3. Platform-attested key (TPM/Secure Enclave attestation) where available.

A bearer-token-only node may **collect posture** (P0/P1) but **must not** run mutating actions. This binding is a hard dependency on `EP-EDGE-NODE` Phase-1 token hardening; P2 cannot start until it lands.

---

## 6. Invariants P2 must satisfy (acceptance)

1. A bearer-token-only Edge Node **cannot** run a mutating action (verified by test).
2. `capability.action.execute` is **disabled by default**; per-`actionType` allow-list enforced Node-side.
3. Every mutating action requires: capability enabled ∧ machine-bound auth ∧ token scope ∧ policy approval ∧ `ChangeRequest` ∧ in-window ∧ not-blackout.
4. Cross-customer dispatch attempts are **rejected**.
5. An MSP-originated action in a sovereign customer DPF reaches at most `proposed`.
6. No shell string construction; package managers invoked by argument vector against an allow-listed binary; parameters schema-validated.
7. `targetVersion >= installedVersion` (no silent downgrade).
8. Recovery-point-before / health-check-after / auto-rollback for DPF-managed hosts; explicit "no rollback available" evidence otherwise.
9. Result evidence captures before/intended/post version + health, and is cross-checked against the next discovery sweep.
10. `script.run` remains **out of scope** until its own threat model.

---

## 7. Residual risk and what stays gated

Even with the above, remote code execution on un-owned hosts carries irreducible risk. Therefore P2 ships **dark and narrow**: the safest `actionType` (`inventory.collect`) first, then DPF-self patching, then opt-in single-host patch with explicit per-action approval — never fleet auto-apply until canary/health evidence and operator confidence accrue. The mutating, cross-org, and auto-policy phases (P3–P5) remain behind their own gates and operator review. This model is the floor, not a license to automate.
