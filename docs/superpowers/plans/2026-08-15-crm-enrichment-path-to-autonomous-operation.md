# Plan — CRM enrichment & CI coworker: path to autonomous, verified operation

Date: 2026-08-15. Epic: **EP-5EA15B45**. Spec:
[docs/superpowers/specs/2026-08-14-crm-enrichment-ci-coworker-design.md](../specs/2026-08-14-crm-enrichment-ci-coworker-design.md).

## Objective

An AI coworker autonomously and safely enriches thin CRM records in production: it recognizes
gaps, offers (permissioned) to research public sources, confirms the identity, proposes a cited
diff, and — on human approval — writes it back with provenance. This plan sequences the path from
the shipped pipeline to that end state, with an explicit **verification** at each phase so "done"
is provable, not asserted.

## Current state (delivered)

- **BI-B2497DFB — enrichment pipeline + tools — DONE & verified live.** `propose_/apply_crm_enrichment`,
  completeness/offer/no-fabrication/proposal/apply core, proactivity binding. All 8 ACs verified
  end-to-end on the canonical install (create → propose → apply, provenance diff visible in the UI).
- **BI-6D10EB1F — CI coworker design + `crm-enrichment` skill — landed** (skill merged, PR #4301).
  `market-research-analyst` seeded as a draft; `customer-advisor` already holds the grants.
- **BI-E2449835 — identity-resolution gate + provenance tuples — DONE** (PR #4325). Hard-block on a
  domain conflict (same-named wrong company), weak-match flag, confidence/retrievedAt/passage.

## Why it is not yet autonomous — the gap is config + guidance, not code

Verified 2026-08-15: the pipeline works, `customer-advisor` holds `web_search`+`crm_read`+`crm_write`,
and `buildPhases` does **not** hide the web tools from coworker chat. What blocks autonomous operation
is a **3-surface, admin-gated turn-on sequence** plus a fragmented operator experience:
1. the per-turn **Web-access switch** (session-scoped);
2. the platform **Brave Search API key** (`brave_search_api_key`, admin UI);
3. **provider routing** health (Azure OpenAI trust-evidence attestation currently blocks all turns).

The coworker cannot set the key or attest (tell-don't-act, correctly) — so the remaining work is
(a) the operator completing config, and (b) a coworker that *guides* them through it as one journey.

## The phased path (each phase names its verification)

### Phase 1 — Config turn-on (BI-FC28F1E3) · owner: operator + platform
Set the Brave key (`/platform/tools/built-ins` or `BRAVE_SEARCH_API_KEY`); ensure external web
access is enablable for the coworker's turns; restore AI model routing (provider attestation). The
`crm-enrichment` skill goes live on the next reseed (assigned to `customer-advisor`, already granted).
**Verify:** `search_public_web` returns results in a coworker turn; a coworker turn completes (no
"no eligible model").

### Phase 2 — Operator-guided enablement (BI-8387D301) · owner: build
Chain the 3 surfaces into ONE guided journey: an `ai-readiness` blocker ("web research / enrichment
not enabled") that composes the 3 checks and emits sequenced `primaryActionLabel`/`href` steps, plus
an **AI Ops Engineer** skill (`skills/ops/enable-web-research.skill.md`) that walks the operator
through it (tell-don't-act), wired to the "Ask coworker for help" hand-off.
**Verify:** on an install with enrichment off, the operator (or the coworker on request) is walked
through the full turn-on and ends able to run the loop; a non-admin is correctly routed to their admin.

### Phase 3 — Live autonomous loop (closes BI-6D10EB1F verification) · owner: me, post-config
Drive the loop through a real coworker chat: thin prospect → coworker offers → researches with
`search_public_web`/`fetch_public_website` → `propose_crm_enrichment` (identity-gated) → human
approves → `apply_crm_enrichment`. Optionally promote `market-research-analyst` for the CI brief use
case. **Verify:** `dpf-verify-on-live-install` CAN-TEST → drive → `record_runtime_verification` with
the observed autonomous behavior (not simulated findings).

### Phase 4 — Remaining safety hardening (rest of BI-E2449835) · owner: build, incremental
Compliance risk-tier + suppression list (personal-contact gating), passage-entailment + taxonomy-enum
checks, per-field freshness SLAs (uses the `retrievedAt` field now present).
**Verify:** unit tests per guard; a personal-contact field is refused without a lawful-basis + a
suppression-list miss; a stale field re-enriches on its SLA.

## Backlog coverage (verifiable)

| Phase | Backlog item | Status |
|---|---|---|
| — (done) | BI-B2497DFB enrichment pipeline | done |
| — (done) | BI-6D10EB1F CI coworker + skill | design/skill landed; verification in Phase 3 |
| — (done) | BI-E2449835 identity gate + provenance | done (Phase 4 = remainder) |
| 1 | BI-FC28F1E3 config turn-on | open |
| 2 | BI-8387D301 operator-guided enablement | open |

All under **EP-5EA15B45**. The path is complete when Phase 3's live runtime verification is recorded.

## Non-goals

Paid third-party data providers; auto-commit without the propose→apply gate; a second CI coworker
(BI-6D10EB1F already landed); the coworker entering credentials or attesting on the operator's behalf
(prohibited — tell-don't-act only).
