---
status: active
---

# Verify toolchain content convergence at equal versions

Backlog: BI-DE1E6485. Workroom: WC-1E64B273.
Extends [release delivery design](../specs/2026-10-07-agent-toolchain-release-delivery-design.md) section 5.3 and [P2b plan](2026-10-07-agent-toolchain-release-delivery.md).

## Scope and observed fault

The Claude project cache can retain different delivered bytes at version 0.2.15 after a supported update returns zero. The updater currently treats equal versions as current and treats zero exit as updated. Reuse `installed_copy_freshness.delivered_digest`; never delete caches or rewrite client-owned installation records. This amendment repairs existing convergence acceptance; it does not reopen the completed detector item BI-16EAAB62 or duplicate BI-A67B65F4.

## Acceptance from the live item

- AC-CONVERGE-ALL: One --from-portal run on Windows and one on macOS/Linux bring Claude local scope, every existing Claude project-scope pin, the shared copy, Codex, Grok and Antigravity to the manifest digest; retire each duplicate project .mcp.json dpf entry by backup and disable; report missing-folder pins as prunable; refuse an origin that is not an already-configured DPF connector origin; and refuse an archive or tree whose hash mismatches.
- AC-REPORT-VERIFY: The updater's JSON report is recorded through record_surface_readiness, and a copy counts as current only when the client's next connection declares the new digest.
- writeMcpJsonToHost no longer writes a dpf entry that duplicates the plugin connector.

## Bounded implementation

1. Claim updater, convergence report and their existing Python tests; consume the change-impact contract before Red. Bind this immutable plan with live coverage. Keep the existing medium shape and current admission; do not manufacture independent approval.
2. First failing fixture: same-version project cache has stale content; mocked supported update returns zero and leaves it stale. Assert it is neither current nor updated, and the report cannot claim convergence. Also cover an update that changes the cache to the expected digest, equal-version already-current content, missing/unreadable cache, missing project, dry run and local scope.
3. Compare delivered content against the verified source pack before selecting no-op. Use the supported Claude plugin update for stale installed records, then re-read records and compare content again. A zero exit without matching bytes is failed convergence with a bounded repair diagnostic. Never delete or overwrite a cache, alter its manifest by hand, bypass hooks or restart clients.
4. Preserve existing result buckets and report consumers. Ensure explicit action labels cannot override an observed after-digest mismatch. Missing identity is unknown/failed, never a pass. Dry run states intent and does not claim observed convergence. Keep loaded-client verification separate from on-disk convergence.
5. Run focused Python suites, source guards and required delivery verification. Freeze and publish with DCO, protected CI and merge queue. Post-release live supported updater verification remains required on Windows and macOS/Linux; source fixtures do not satisfy that acceptance. No live client restart during active work.
6. Deliver distinct versioned bytes through the existing release path. Change only `packages/dpf-skill-pack/toolchain-version.json` from 0.2.15 to 0.2.16, preserving the unchanged null floor. Run `scripts/sync-toolchain-version.mjs` to generate the four client plugin manifests and the root `.claude-plugin/marketplace.json`; never hand-edit their versions. Verify the generator's existing fixture suite, version drift check and generated client-capabilities check. This remains part of `agent-converges-host` / AC-CONVERGE-ALL: a same-version diagnostic does not replace publishing a new cache identity. Independent review must cover the generated delta. Canonical signed manifest/archive delivery and subsequent supported updater/digest verification remain separate release evidence; no live client update or restart during another owner's verification window.

## Coverage

| Deliverable | Backlog | Requirements | Contract | Flow | Verification |
| --- | --- | --- | --- | --- | --- |
| equal-version-content-convergence | BI-DE1E6485 | OBJ-CONVERGE, OBJ-OBSERVE | verified-content-before-success | agent-converges-host | AC-CONVERGE-ALL, AC-REPORT-VERIFY, host-writer-preserved |

`verified-content-before-success` requires expected delivered digest before a successful action/report. `agent-converges-host` uses the existing supported updater and canonical distinct-version publication above. `host-writer-preserved` retains the existing duplicate-connector regression. The deliverable is atomic: selection, reporting and delivered cache identity must agree, otherwise a truthful selector can still produce a false successful report or leave users on stale bytes.

## Verification limits and rollback

No new cache manager, registry, digest, schema or restart mechanism. If the supported CLI cannot refresh equal-version bytes, report failure and retain the diagnostic; a successful command alone is not repair. Revert this source pair through normal PR delivery if existing clients regress. Retain client-owned data and historical evidence. Publication-cost audit evidence remains in BI-5445CECA and is not a performance claim for this repair.
