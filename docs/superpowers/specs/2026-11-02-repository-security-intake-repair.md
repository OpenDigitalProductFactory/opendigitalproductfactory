---
status: draft
---

# Repository security intake repair

Backlog: BI-2422A366. Workroom: WC-3BB460F8.

## Problem and evidence

On served revision 36b46866870694dab1763e691862da38dc577e76 the commissioned
repository controller completed its November 2 scan, but reads only open issues
and peer demand. The latter has recurrence semantics rather than source
reconciliation: the scan reports 3971 recurrences and 38 ambiguous issue origins.
Six open Dependabot alerts (#232, #238, #254–257) have no reader in this intake.
An empty estate patch report does not establish repository alert coverage.
The existing GitHub security-findings watch is healthy: run 41483190081 updated
standing issue #4389 with all six findings on November 2. Preserve that detector;
the defect is actionable per-alert backlog coverage, not a missing provider scan.

## Existing design and selected repair

Extend the existing ecosystem issue intake and backlog origin reconciliation
from `2026-09-16-ecosystem-issue-intake-and-arbitration-design.md` §6.1.
Reuse the commissioned repository, encrypted controller credential resolver,
owned GitHub transport, bounded pagination, backlog front door, source snapshots,
and scheduled-job result. No new queue, table, credential or scheduler.

Use GitHub's repository Dependabot alerts REST endpoint (read only), documenting
an authorization failure as incomplete security coverage, never an empty success.
Reference: https://docs.github.com/en/rest/dependabot/alerts . Repository access
alone does not imply Dependabot permission; do not broaden credentials silently.

Give each alert a distinct repository-qualified source identity and a fingerprint
of its meaningful fields; repeat polls retain one item and do not inflate demand.
Preserve severity, advisory, manifest, affected range, patch availability and link.
Do not automatically dismiss alerts or mark backlog work complete from source
state alone. Reuse the same reconciliation for peer demand to stop poll inflation.
Read changed issue states, including closure, rather than only open issues.
Ambiguous historical origins stay visible for governed reconciliation; never
guess the canonical delivery item or retire it to improve metrics.

## Ordered implementation and verification

1. Add failing behavior tests for security transport failures, pagination,
   alert provenance/idempotency, unchanged peer demand and closed issue reads.
2. Add a bounded typed alert reader using the existing transport and credential
   resolver, and map alerts to existing origin reconciliation inputs.
3. Wire security coverage into the commissioned runner. Persist source-specific
   failures in its existing scan summary. Reconcile peer source fingerprints.
4. Run affected unit tests and web typecheck, then the governed merged-code gate.
   Publish through a DCO-signed PR and queue, advance through self-upgrade, and
   observe the real recurring scan on the canonical runtime.
5. Reconcile each GitHub alert with its canonical backlog item and prove a repeat
   scan leaves item and occurrence counts stable. Reconcile ambiguous historical
   issues through existing backlog tools only with verified canonical evidence.
6. Follow the existing Dependabot remediation skill for current alerts, with
   separately scoped delivery if dependency changes are independently shippable.
   No-patch advisories require evidenced exposure/removal treatment, not dismissal
   to force a clean result. Verify GitHub closure and record remaining exposure.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | The commissioned controller detects repository alerts and reports incomplete reads explicitly. |
| AC-2 | OBJ-1 | Repeated unchanged alert and peer reads preserve canonical item and occurrence counts. |
| AC-3 | OBJ-1 | Issue state changes are observed and ambiguous historical matches remain explicit. |
| AC-4 | OBJ-2 | Current alerts have canonical backlog coverage and governed remediation with upstream verification. |

**OBJ-1:** The repository-controller installation operates a reliable repository intake using existing platform primitives.

**OBJ-2:** Address the verified vulnerabilities through the platform delivery process.

## Dependency treatment delivery

BI-1D8EC7F7 is the independently shippable dependency repair under OBJ-2 / AC-4.
It is a manually requested delivery batch, not evidence of automatic detection.
Link the controller's per-alert records after live intake; retain their provenance.
Floor glob to 14.0.2 and minimatch to 11.0.1 in both workspace override files,
with advisory comments for Dependabot #254–257. Preserve the existing patched
brace-expansion floor. Regenerate both locks with fresh metadata and reject
unrelated version drift. No new schema, credentials, service or UI is required.

These floors cross majors. Verify the actual rimraf, Expo configuration and
fingerprint, Jest and coverage consumers. The current root minimatch9/brace5
pair throws on brace patterns; the patched pair must resolve that reproduction.
Minimatch11 removes makeRe, so inspect consumers rather than assuming complete
API compatibility. Isolated probes passed the APIs inspected so far, but do not
replace actual-workspace tests, typechecks or the canonical integration gate.
The ordered plan is ../plans/2026-11-02-repository-security-remediation.md.
Publish only after live automatic intake has been demonstrated. Zod/deepmerge
advisory disposition remains a separate operational treatment under the parent;
neither is silently suppressed by this dependency patch.

## Boundaries

Release prerequisite discovered during verification: the existing application
boundary reviews expired November 1 and block normal publication on the base
tree as well. Reuse the existing registry and BI-9BEB3D56 inquiry. The
[per-edge disposition](../../architecture/application-boundary-review-2026-11-02.md)
records fresh source analysis, removal of one obsolete key and retention of
42 exact existing keys only until the existing November 16 budget. WWMD
DI-16446C24A439 permits that bounded choice autonomously. Preserve prior dates,
context owners, unchanged guard enforcement and independent exact-change review;
do not claim the remaining dependency refactors are complete.

The existing Scheduled Work Run now action dispatches the same commissioned
intake on its existing event rail. Manual and recurring runs share one account
concurrency lane. Both honor quiescence; the recurring run also honors the
schedule enable switch. Source changes are recorded in intake activity without
overwriting curated backlog text or automatically reopening completed work.

The scheduled-work UI refactor belongs to another chat. Contributor inventory
and SIEM permission denials remain in force. Read-only ScheduledJob diagnostics
are independent of those denied operations. No new provider or budget is added.
