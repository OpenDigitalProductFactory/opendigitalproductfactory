---
status: active
---

# Owned prototype capture implementation

Backlog: BI-CA4DC298. Workroom: WC-49FB71DF. Design: `docs/superpowers/specs/2026-11-13-owned-prototype-capture-design.md`. Status: plan draft; implementation unrun. Kernel choice: DI-7652EE1A746E.

For agentic workers: execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus this completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Original item acceptance

- An agent can fulfil a UX critique engagement end to end, and the critic produces findings.
- CE-023F9DDF, or its successor, produces findings for `/ops/workrooms`.

The operator install's CE83 mailbox prototype is an additional integration target. It cannot replace either original criterion, authorize historical replay, or silently create a successor for an archived engagement. Existing BI-BCBCA8D1 owns engagement dispatch and original/current settlement. Coordinate its existing owner if that dependency blocks acceptance.

## Delivery boundary and traceability

One atomic producer contract: source qualification, isolated rendering, owned image/manifest storage and existing-consumer delivery are internal sequencing. Shipping only a callable renderer or a screenshot does not fulfil the item. No duplicate producer BI, parallel store, new runtime or provider is needed. Archived-room lifecycle repair, if still required, stays with existing BI-BCBCA8D1; this plan does not claim it is delivered.

| Requirement reference | Contract reference | Flow reference | Verification reference | Covering item |
| --- | --- | --- | --- | --- |
| CAP-REQ-1 exact owned source and pixels | CAP-CONTRACT-1 original engagement/artifact/actor manifest | CAP-FLOW-1 admit → qualify → render → store → Critic | CAP-VERIFY-1 real original findings and room return | BI-CA4DC298 |
| CAP-REQ-2 isolated bounded execution | CAP-CONTRACT-2 no profile/network/SSRF exception | CAP-FLOW-2 failure → cleanup → typed hold | CAP-VERIFY-2 adverse authority/network/resource cases | BI-CA4DC298 |

## Steps

1. **Qualify scope and source (internal).** Refresh actual main and overlapping rooms/PRs. Claim exact paths before edits; consume the refreshed Workroom testImpact/guardObligations. Current design-only impact requires doc-index regeneration; it grants no runtime exemption. Record live backlog coverage against the pushed immutable plan. Obtain actual implementation admission and any architecture/security/design review it requires. Resolve recorded funding before paid reviewer or runtime allocation.

2. **RED contract tests (internal).** Extend existing `apps/web/lib/coworker-service-catalog/engagement-visual-evidence.test.ts` and service-catalog tests around the missing producer boundary. Assert exact source identity, original/current authority, no side effects on refusal, immutable owned versions accepted by the unchanged consumer, and no image bytes in the model result. New producer modules/tests are proposed under the existing service-catalog directory; settle filenames in the exact scope claim. Keep existing consumer tests passing. Show the new behavior test fails before implementation.

3. **Bound source and storage (internal).** Reuse original engagement validation, immutable source readers, document access/store and blob-storage helpers. Read exact approved bytes server-side; reject wrong actor/org/commit/blob and unsupported or oversized source before rendering. Expose no caller filesystem path, arbitrary URL, profile or executable action argument. Preserve authority through final image/manifest publication and use a stable request identity for concurrent duplicates. Record typed partial/unknown outcomes without redoing an uncertain render.

4. **Implement isolation in the existing service (internal).** First resolve the three independent design blockers recorded in the design: current root/sandbox-disabled launch with profile mounts, undeclared rendering API, and authenticated-fetch versus offline-byte provenance. Extend `services/browser-use/server.py` through a separate explicit offline artifact operation and focused tests. The proposed child uses an explicitly pinned Python Playwright dependency and the existing Chromium executable under a distinct unprivileged identity with clean environment and no secret-volume access. Sandbox startup failure must return unavailable, never retry with sandbox disabled. Qualify actual container compatibility and existing profile permissions. Fresh nonpersistent context; no credentials/profile; blocked service workers; deny all network, navigation, WebSocket, popup, download and storage channels before loading bytes. The ordinary `url_policy.py` guard stays unchanged. Extend the existing document content route with an explicit pinned preview query and restrictive HTTP CSP sandbox; default attachment behavior remains. Rendering fulfils the initial logical source request from qualified bytes internally, not an authenticated network fetch; record that distinction in the manifest and limitations. Initial capture is default state only with explicit viewport/theme and finite time/pixel/output limits.

5. **GREEN and adverse proof (internal).** Produce genuine PNG/JPEG bytes, probe and hash them, store versions internally as the requesting principal, then create the existing manifest. Test every identity substitution, revoked/displaced execution fence, duplicates, script/network attempts including service workers, popups/downloads, malformed/oversized source, oversize images, timeout, browser unavailable and cleanup. Run affected Python/TypeScript tests and affected package typechecks from a compile-ready worktree; apply no schema migration unless newly required and independently admitted. Required code-path impact and security tests supplement this list.

6. **Protected delivery and business verification (atomic deliverable).** Obtain actual independent code/security and changed-surface review receipts; run canonical shared-runtime convergence and required checks, signed protected PR via `pnpm land`, then canonical update through its existing owner. Verify containing bytes before one permitted original Critic request. Verify owned capture provenance, actual pixels, actual saved findings, original-room return and attributable dispositions. Only then record acceptance. Exercise the original Work Atlas criterion through a legitimately bound current room; do not replay UNKNOWN history, invent successor authority, or claim CE83 alone closes the item.

## Risks and rollback

Untrusted HTML can attempt network access, resource exhaustion or browser escape; isolation and finite resource admission are mandatory. Document identity must not accidentally adopt the human's principal or another organization. A capture result can be orphaned if authority changes during rendering; preserve existing fencing and report the actual outcome. Disable the new producer entry through its existing governed lifecycle if faulty; retain immutable evidence and existing engagement history. Reverting the scoped PR restores prior behavior without changing ordinary browsing, mailbox grants or customer records.

## Backlog coverage

Native atomic coverage cmwfdz0qx06za0ep4bg9no1ku binds the original plan at c66b98869c86b5d7513a9c138132ce9500bf8517, blob31a2c18d7c8ccea4931082c8b36af83986f97cca, to BI-CA4DC298 and the two traceability rows. This subsequent design-review amendment must receive refreshed coverage before implementation; the earlier receipt does not approve changed content. Research and plan/implementation projections were admitted, but the independent design findings remain unresolved. No implementation/runtime tests, deployment or original acceptance criterion has passed. Funding attribution is awaiting the exact owner approval; no paid review or shared-runtime allocation is inferred. A checklist is not a substitute for the native coverage receipt.
