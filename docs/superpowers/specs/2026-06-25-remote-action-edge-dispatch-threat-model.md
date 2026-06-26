# RemoteAction Edge-Dispatch — Threat Model (P2 gate)

**Date:** 2026-06-25
**Status:** Draft (gates P2 — no execution channel ships until this is accepted)
**Author:** Claude (Opus 4.8) with founder direction
**Epic:** `EP-REMOTE-ACTION` (P2 prerequisite)
**Requires:** convergent design `docs/superpowers/specs/2026-06-25-convergent-remote-action-execution-design.md` §7; estate-patch-management §8 ("a focused threat model runs before any P2 execution work").

> This document does **not** open the dispatch channel. It is the analysis the spec
> requires *before* P2 code exists, so the go/no-go is informed. P1 (the governed
> record + seam, [#2391]) ships nothing that executes; P2 is what makes execution
> real, and it must clear every requirement in §5 first.

## 1. What changes at P2 (and why it is dangerous)

P1 materializes `RemoteAction` rows that rest at `status="queued"`. Today there is
**no platform→Edge dispatch channel** — the Edge is push/pull-only (enroll,
heartbeat, discovery, events, metrics upload; adapters pull). P2 opens a *downward*
channel: the platform tells an Edge Node to **do** something on a host it
administers. That is, by construction, remote code execution on a customer estate.
The blast radius of getting it wrong is a compromised fleet, exfiltrated client
data, or a malicious actor using DPF as their dispatch plane.

## 2. Trust boundaries & assets

| # | Boundary | Crossing |
| --- | --- | --- |
| B1 | DPF authority core → Edge Node | the **new** dispatch channel (P2) |
| B2 | Edge Node → target host | native package managers / service control |
| B3 | MSP DPF → Customer DPF | the federation link (cross-org) |
| B4 | Operator/agent → approval state | who may move a `RemoteAction` past `proposed` |

**Assets:** the dispatch channel's integrity (a forged/replayed dispatch = arbitrary
host action); the Edge node token (`dpfedge_`) and the P2 `action:dispatch` /
`action:report` scopes; the target host; the customer's raw host evidence and data
sovereignty; the `RemoteAction` approval state (must be unforgeable).

## 3. Threats → mitigations

| # | Threat (STRIDE) | Vector | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| T1 | **Command injection** (Tamper/Elevate) | malicious `parameters` smuggle a shell command | **No free-form commands.** `actionType` is an allow-listed map to *parameterized, pre-defined* operations; `parameters` schema-validated server- and Edge-side; `script.run` stays out of scope until its own threat model | bugs in a parameterized handler |
| T2 | **Package-manager abuse** (Tamper) | `patch.apply` installs malicious/arbitrary or unsigned packages | target version + source pinned from the catalog/advisory; native-manager signature verification; allow-listed managers only; no arbitrary repo | supply-chain of an upstream package |
| T3 | **Token theft** (Spoof) | stolen `dpfedge_` token impersonates a node / receives dispatches | **Machine-bound trust** (mTLS / DPoP / platform-attested key) so a bare token is insufficient; short-lived dispatch tokens; scope split (dispatch ≠ report) | host-key compromise (out of scope — host is trusted) |
| T4 | **Replay** (Tamper) | re-send a captured dispatch to re-execute (re-reboot, re-apply) | dispatch is **signed, single-use, expiring**; server tracks consumed `actionKey`s; idempotency keyed on `actionKey` | clock skew (bounded by expiry window) |
| T5 | **Confused deputy across customer scope** (Elevate) | node A executes an action scoped to customer B; dispatch crosses tenant boundary | `customerAccountId`/`customerSiteId` on every `RemoteAction`; the node's accepted scope checked against the action scope at dispatch **and** at the node; reject cross-scope | misconfigured node scope (caught by enroll review) |
| T6 | **Downgrade attack** (Tamper) | force an older/vulnerable version | monotonic version check; refuse downgrade unless explicitly flagged + separately approved | none material |
| T7 | **Rollback failure** (DoS) | an irreversible action bricks the host | rollback-impossible actions declare it *before* approval + store compensating evidence; mandatory post-action health check; reboot is a first-class action, never a side effect | physical/firmware bricking (manual recovery) |
| T8 | **Compromised Edge reporting** (Repudiate/Tamper) | a malicious node lies (reports success on a malicious apply) or exfiltrates | result-evidence schema + **independent posture re-collection** to corroborate; node trust-posture monitoring; quarantine on anomaly; a node cannot widen its own scope | a fully-owned node within its existing scope (bounded by T5 + least privilege) |
| T9 | **MSP self-approval across the link** (Elevate) | MSP marks its own proposed action `approved` in the customer's DPF | **structural:** `originLinkId != null` ⇒ no transition past `proposed` without a customer-side `approvedByPrincipalId`; the federation exchange auth path cannot set approval; approval only via the customer's own decision surface | customer-side operator compromise (out of scope) |
| T10 | **Sovereignty leak** (Info disclosure) | raw host evidence flows back to the MSP beyond the consented projection | the R5 egress projection gate (`projection-egress`) applies to result evidence sent back over the link; minimum-necessary | projection misconfiguration (visible in the R6 "Shared scope" surface) |
| T11 | **Spoofed dispatch** (Spoof) | an attacker (not the platform) sends a dispatch to a node | node verifies the dispatch is **signed by the platform authority** (mutual auth), not bearer-only | authority-core key compromise (highest-tier secret, separate control) |
| T12 | **Host privilege escalation** (Elevate) | the Edge runner runs elevated; a compromised action → full host control | least-privilege execution per action-type where the OS allows; elevated ops audited + change-request-gated; no implicit elevation | OS-level escape (out of scope) |

## 4. Federation-specific notes (B3)

The convergent design routes MSP-originated remediation through the *same*
`RemoteAction`, so the cross-org threats (T9, T10) are not add-ons — they are the
reason the proposal-not-action rule is **structural** (enforced at the row via
`originLinkId`) rather than a policy string. An MSP can propose; only the customer's
own authority + the customer's own Edge can execute. P2 must preserve this at the
dispatch layer: a dispatch for an action with `originLinkId != null` and no
customer-side approver is rejected before it reaches the channel.

## 5. Security requirements that GATE P2

No mutating dispatch ships until all are designed and R1–R5 + R7 are *implemented*:

- **R1 — Machine-bound Edge trust** (mTLS / DPoP / attested key). Bearer-only nodes may `inventory.collect`/`diagnostics.collect`, never mutate.
- **R2 — Split, short-lived, scoped tokens** (`action:dispatch`, `action:report`).
- **R3 — Per-node action-type allow-list**; `capability.action.execute` default-off.
- **R4 — Signed, single-use, expiring dispatches** (anti-replay, anti-spoof).
- **R5 — Scope enforcement** (customer/site) at dispatch *and* at the node.
- **R6 — Parameterized actions only**; no free-form command; `script.run` excluded.
- **R7 — Result-evidence schema + independent posture re-collection** (anti-lying-node).
- **R8 — Federation sovereignty**: egress projection on result evidence; structural no-self-approve.
- **R9 — Rollback declaration + post-action health check**; reboot first-class.
- **R10 — Node trust-posture monitoring + quarantine.**

## 6. Recommended go/no-go for P2

1. **Read-only pilot first.** Open the channel for `diagnostics.collect` / `inventory.collect` only, under R1–R5 + R7. No state change leaves the host; this exercises the channel, signing, scope, and evidence path with the lowest blast radius.
2. **Mutating dispatch (`service.restart`, `patch.apply`, `reboot`) only after** the read-only pilot is proven *and* R6, R8, R9 are implemented *and* the founder signs off per action-type.
3. **`script.run` never** under this model — it requires its own separate threat model (per patch §7.3).

## 7. Open questions for the founder

1. **Machine-bound trust mechanism** (R1): mTLS client certs vs. DPoP vs. a platform-attested key — affects Edge agent packaging and the enrollment flow.
2. **Read-only pilot scope**: is a `diagnostics.collect`-only P2 acceptable as the first channel increment, or hold the entire channel until mutating is also designed?
3. **Per-action-type sign-off**: confirm the founder is the approver for promoting each `actionType` from gated to enabled.
