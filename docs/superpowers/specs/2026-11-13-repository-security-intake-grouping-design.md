# Repository security intake: grouped, prioritised, closed when GitHub resolves

**Backlog item:** BI-C67E5CCB · **Extends:** BI-F47386ED (inbound triage), BI-952F08BA (origin reconciliation) · **Related:** BI-3077CFB9 (issue closure observation), BI-FD40397B (controller commission) · **Kernel decision:** DI-9446F1619C33 (issue exclusion scope, D2)

## Problem

The commissioned intake job `ecosystem-inbound-issue-triage` (every 4 hours, server-side, `apps/web/lib/queue/functions/ecosystem-inbound-triage.ts`) already turns GitHub issues and Dependabot alerts into backlog items through the backlog front door. Live state on 2026-11-13:

| Gap | Evidence |
| --- | --- |
| CodeQL code-scanning alerts are never read | 4 open on GitHub (1 high: `js/polynomial-redos`, `packages/storefront-templates/src/product-mix.ts`); 0 backlog items |
| Secret-scanning alerts are never read | 0 open today; no reader exists, so a leaked secret would not reach the backlog |
| One item per Dependabot alert | 42 Dependabot items, about 29 of them for `undici` in one lockfile |
| No priority | every inbound item has `priority = null` |
| Fixed/dismissed alerts never close their item | the reader asks `state=open`; 38 items open/triaging against 33 open alerts (hono, @hono/node-server, fast-xml-parser fixed upstream, items still open) |

The daily `security-findings-watch.yml` report (issue #4389) stays report-only. This design changes only the intake job.

## Objectives

**OBJ-1:** Every open security finding on the commissioned repository, from Dependabot, CodeQL code scanning and secret scanning, is a backlog item after one intake run.

**OBJ-2:** Findings are grouped so one item tracks one unit of remediation, with a stable key so repeat runs update rather than duplicate.

**OBJ-3:** Priority follows severity; every leaked secret and every critical finding ranks first.

**OBJ-4:** When GitHub reports a group fixed or dismissed, its item closes. When a fixed group reappears, its item reopens as a regression.

**OBJ-5:** A surface that cannot be read is reported unreadable, never as zero, and it never closes anything.

## Acceptance

| ID | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | A run with readable surfaces files or reconciles one item per group across all three surfaces; the run summary lists counts per surface. |
| AC-2 | OBJ-2 | Dependabot groups by (ecosystem, package); CodeQL by rule id; secret scanning by alert number. Re-running with unchanged alerts creates no item and records no change. |
| AC-3 | OBJ-3 | Priority is secret=1, critical=1, high=2, medium=3, low/note/warning=4, from the highest open severity in the group; it is written on create and when the tier changes, never on an unchanged poll. |
| AC-4 | OBJ-4 | A group absent from a complete open read records resolution evidence on its non-terminal item and moves it to awaiting-acceptance, where the existing acceptance sweep closes it; a reappearing group returns an awaiting-acceptance item to open, and a reappearance on a done item is reported as a regression. |
| AC-5 | OBJ-5 | A 401/403/404, malformed body or truncated pagination on any surface is a source error; no item from that surface is closed or reopened in that run; the job reports failed with the surface named. |
| AC-6 | OBJ-2 | No per-alert Dependabot origin is filed after the change; existing per-alert items are retired once as duplicates of their package group item, not deleted. |
| AC-7 | OBJ-1 | A secret-scanning item never contains the secret value: type, location path and alert URL only. |

## Research

| Comparable | How it groups | How it closes | DPF adopts / rejects |
| --- | --- | --- | --- |
| GitHub security overview / Dependabot grouped security updates | per package and ecosystem (one PR fixes every advisory on a package) | alert state `fixed` when the manifest no longer resolves a vulnerable version | **Adopt** per-package grouping: one upgrade is one unit of remediation |
| DefectDojo deduplication | hash of (tool, rule/CWE, component, location); a finding absent from a re-import is mitigated | auto-close on absence from a complete re-import ("close old findings") | **Adopt** close-on-absence, but only on a complete read (DefectDojo closes on any re-import; we refuse on partial coverage) |
| Snyk project issues | per vulnerable package (with all paths) | resolved when the package no longer resolves | **Reject** Snyk's per-path detail as a separate item: the paths go into the body |

The standard for state is GitHub's REST alert APIs (`/dependabot/alerts`, `/code-scanning/alerts`, `/secret-scanning/alerts`), whose `state` values are `open`, `fixed`, `dismissed`, `auto_dismissed` and `resolved`. Severity follows the GHSA/CVSS bands (critical, high, medium, low) and CodeQL `security_severity_level`, falling back to `rule.severity` (error→high, warning→medium, note→low) for non-security rules.

## Design

### Readers (beside `dependabot-reader.ts`)

`code-scanning-reader.ts` and `secret-scanning-reader.ts` copy the Dependabot reader's contract exactly: the controller credential from `resolveGithubToken(prisma, { preferRepositoryController: true })`, the owned transport, an origin-pinned Link-header pager, `redirect: "error"`, and a `{ ok:false, error }` result for every non-200, malformed or truncated read. A 403 names the missing permission ("Code scanning alerts: read" / "Secret scanning alerts: read"). The secret reader drops the `secret` field at parse time, so the value never enters process memory beyond the HTTP body.

### Grouping (pure, `security-finding-groups.ts`)

`groupSecurityFindings(surface, alerts, repo)` returns one `InboundEcosystemItem` per group:

- `sourceKind` is `dependabot-package`, `code-scanning-rule` or `secret-scanning-alert`. The origin is `ecosystem-<kind>:<owner/repo>#<key>`, the existing qualified origin form, so `reconcileOrigin` applies unchanged.
- The key is `<ecosystem>/<package>` for Dependabot, the rule id for CodeQL and the alert number for secret scanning.
- The title, for example `Upgrade undici (npm): 10 high, 14 medium, 5 low advisories`, and the body list every alert number, advisory, manifest, affected range and patched version.
- `state` is `open` while any alert in the group is open. The fingerprint covers the set of open alert numbers and the highest severity, so a new advisory on the same package is a recorded `changed`, not a new item.
- `priority` comes from the AC-3 table.

### Lifecycle (`security-finding-lifecycle.ts`)

This runs after ingest, only for surfaces whose open read was complete. It loads non-retired items carrying the surface's origin marker. **The job closes nothing itself.** Closure reuses the existing chain:

- **Absent from the open read, item is triaging/open/in-progress**: the job records one `evidence` activity on the item, "GitHub no longer reports <group> open", with the alert numbers, the read time and, when a best-effort `state=fixed`/`state=dismissed` read succeeds, each alert's final state and dismissal reason. It then moves the item to `awaiting-acceptance`, a legal non-admin transition. The existing acceptance sweep (`acceptance-sweep-daily`) closes it to `done` when the completion gate allows, under the operator pre-authorisation `acceptance-sweep.close-authorisation` (enabled on this install 2026-10-13). This is the same evidence-then-close sequence an agent used by hand for BI-E6A1EB76 (Dependabot #256) on 2026-11-03, now automatic. A dismissed group closes the same way; its resolution names the dismissal reason.
- **Present again, item is awaiting-acceptance**: the job moves it back to `open` with a `regression` activity.
- **Present again, item is done**: reopening a done item needs an admin grant, so the job does not do it. Origin reconciliation already records a `reopened` source event on the canonical item. The job counts it as a regression in the run summary, and the scheduled-job attention source surfaces it to an owner.
- **Priority**: an item whose recorded tier differs from the group's current tier gets its priority updated with an activity. An unchanged tier writes nothing.

An item with an active build is not moved. The evidence activity is still recorded, so the person working it sees the finding is gone.

### Migration of per-alert items

`mapDependabotAlerts` is replaced by the package grouping, so no per-alert origin is filed again. The existing non-terminal per-alert items (about 38 today) are retired once, after the change is live, as duplicates of their package group item. This is a governed `retire_backlog_item` call by the delivering agent, not job code. Done per-alert items are left as they are.

### Reporting

`summarizeScan` gains a per-surface line, for example `dependabot 33 alerts / 3 groups; code-scanning 4 / 3; secret-scanning 0 / 0; closed 4, reopened 0`. Each unreadable surface stays in `sourceErrors` and makes `lastStatus = failed`. This is the existing incomplete-coverage path.

## Out of scope (separate items)

- Issue exclusions (#4389, issues mirroring a local outward filing) and drafting replies to an issue when its item is done. Filed as D2 in the plan; a reply's wording is shown to the operator before first send.
- Fixing findings. `dpf-clear-dependabot-alerts` remains the fixer; this job only feeds it.

## Risks

- **Controller credential lacks code-scanning or secret-scanning read.** That surface reports unreadable (AC-5) and the operator is told the exact permission. No silent zero.
- **Closing on a stale read.** Closure only happens on a complete read of that surface, inside the same run as the read.
