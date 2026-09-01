---
status: active
title: Executable initiative-readiness recovery packets
---

# Executable initiative-readiness recovery packets

**Backlog item:** `BI-9FE775F9`
**Epic:** `EP-129D11FD` — Initiative Readiness and Governed Completion Enforcement
**Observed on:** `BI-7A38F667` / `WC-16B8E810` at head `e5f86ccbfb368c5cfa7571173d50a08ce66920ef`

## 1. Decision summary

When governed readiness refuses a claim, the server hands back reviewer routes
so the blocked Workroom can recover without an administrative database edit.
Those routes are not executable today. `requestCoworkerPacket` emits six fields;
`request_coworker` needs two more — `initiativeReviewBinding` and
`requiredToolNames` — before it will grant the dispatched coworker the writer
tool and the immutable artifact identity. The dispatched reviewer therefore
arrives with neither the document to inspect nor the grant to record a result.

The generator is not withholding the fields. It cannot build them: an
`initiativeReviewBinding` requires `artifactRef.path` and
`artifactRef.providerBlobId`, and the recovery path has never known either. The
code refuses to invent them, correctly — but it then emits an unusable packet
instead of saying so.

This change gives recovery a real canonical-artifact source, mints the binding
from it, and makes every unroutable requirement escalate out loud.

## 2. Outcomes and objective baseline

| Objective | Baseline | Target |
|---|---|---|
| `OBJ-PACKET-EXECUTABLE` | Reviewer routes omit `initiativeReviewBinding` and `requiredToolNames`, so `request_coworker` dispatches without the writer tool. | A route carries the exact writer, the immutable readers, and a provider-verified artifact binding. |
| `OBJ-PACKET-HONEST` | When no artifact can be bound, the route is emitted anyway and fails at the callee. | When no artifact can be bound, recovery emits an escalation naming the missing input and its remedy. |
| `OBJ-PACKET-COMPLETE` | `artifact-resolver`, `delivery-coordinator` and `acceptance-reviewer` have no lane, so their requirements vanish from recovery. | Every unmet requirement produces a route or an escalation; none is silently dropped. |

## 3. Research & benchmarking

- **GitHub Checks / required reviewers.** A check run binds to an exact `head_sha`
  and the reviewer resolves the diff itself. **Adopt:** the immutable head is the
  binding key. **Reject:** letting the reviewer choose the artifact — DPF's
  receipt must name the reviewed bytes, not a branch that can move.
- **Gerrit change-ref review.** Each patchset is a distinct immutable ref, and
  review authority is granted per-ref. **Adopt:** per-artifact authority scope
  rather than a standing grant. **Reject:** Gerrit's separate review namespace;
  DPF already has Workroom head identity and does not need a second one.
- **Sigstore / in-toto attestation.** Subject digest plus predicate, verified
  against a transparency log. **Adopt:** resolving the blob id from the provider
  and verifying it, so the binding is provider-attested rather than caller-
  asserted. **Reject:** a separate signing chain — the DCO trailer and Workroom
  ownership already carry authorship, checked by `resolveRepositoryArtifact`.

## 4. Current substrate audit

- `apps/web/lib/tak/initiative-readiness-tool-grants.ts` — `INITIATIVE_READINESS_LANES`
  maps accountable role to writer tool, grant and gates.
  `resolveInitiativeReviewerRecovery` resolves eligible production agents and
  builds routes; `requestCoworkerPacket` shapes the handoff.
- `apps/web/lib/mcp/packs/coworker-pack.ts` — declares `requiredToolNames` and
  `initiativeReviewBinding` on `request_coworker` and `summon_coworker`, and
  documents them as coming from a server-issued recovery packet.
- `apps/web/lib/mcp/external-coworker-task-adapter.ts` — `initiativeReviewPacket`
  requires both fields together, requires the bound writer plus at least one of
  `read_source_at_version` / `search_source_at_version`, and derives
  `authorityScope` as `backlog-item:<itemId>` plus `tool:<name>` per name.
- `apps/web/lib/mcp-task-submit.ts` — `parseInitiativeReviewBinding` requires a
  `record_initiative_*` writer, a `BI-` subject, a gate, and a complete
  `repo-blob-at-commit` ref.
- `apps/web/lib/backlog/initiative-readiness/repository-artifact.ts` —
  `resolveRepositoryArtifact` **validates** a locator whose `providerBlobId` the
  caller already knows. It resolves repo identity, requires exactly one live
  Workroom at the commit, requires a single DCO sign-off, and verifies the blob
  id against `GET /contents`. It does not discover a path or a blob id.
- `apps/web/lib/backlog/spec-plan-search.ts` — `searchSpecsAndPlans` scans the
  **deployed install filesystem**. It cannot see a design authored on a feature
  branch, so it is not a source for this binding.

No existing helper reads the GitHub compare endpoint.

## 5. Canonical artifact discovery

New module `apps/web/lib/backlog/initiative-readiness/canonical-artifact-discovery.ts`.

```
discoverCanonicalDesignArtifact({ repositoryFullName, baseSha, headSha, db?, fetchImpl? })
  -> { ok: true; path: string; providerBlobId: string }
   | { ok: false; code: "no-canonical-design" | "ambiguous-canonical-design"
                      | "provider-unavailable"; nextAction: string }
```

It reads `GET /repos/{owner}/{repo}/compare/{baseSha}...{headSha}` and keeps
files under `docs/superpowers/specs/` with a `.md` suffix whose status is not
`removed`. The compare payload carries `filename` and `sha` per file, so the
blob id is provider-supplied, never derived locally.

- Exactly one match → bind it.
- Zero matches → `no-canonical-design`, remedy: commit the design under
  `docs/superpowers/specs/`, push, re-sync the head with `adopt_worktree`.
- More than one → `ambiguous-canonical-design`, remedy: name the canonical
  design; the escalation lists the candidates.

Repo identity and provider credentials reuse `resolveRepoIdentity` and
`resolveGithubToken` from `repository-artifact.ts`; both are exported for reuse
rather than reimplemented.

**Why the compare range, not the head commit.** A design is frequently authored
across several commits on a branch. `GET /commits/{sha}` returns only the last
one's files, which would miss it. The Workroom already records `baseSha`.

## 6. Binding and route shape

`InitiativeRecoveryDispatchContext` gains `baseSha: string | null`.
`resolveInitiativeReviewerRecovery` gains an optional
`canonicalArtifact: { path: string; providerBlobId: string } | null` resolved by
its caller, keeping this module free of provider I/O.

`requestCoworkerPacket` additionally emits:

```
requiredToolNames: [<writer tool>, "read_source_at_version"]
initiativeReviewBinding: {
  writerToolName: <writer tool>,
  itemId: <decision.subject.id>,
  gate: <gate>,
  expectedCurrentBaselineId: <current baseline id or null>,
  artifactRef: {
    kind: "repo-blob-at-commit",
    repositoryFullName, commitSha: headSha, path, providerBlobId,
  },
}
```

This satisfies `initiativeReviewPacket`: two names, the bound writer included,
one permitted immutable reader, no other names. The resulting `authorityScope`
is `backlog-item:<itemId>`, `tool:<writer>`, `tool:read_source_at_version`.

`expectedCurrentBaselineId` is the `baselineId` already returned by
`projectBacklogItemReadiness`, threaded through the caller. It is `null` before
spec-approval mints the first baseline, which the parser permits.

**When `canonicalArtifact` is null the route is not emitted.** Recovery pushes an
escalation carrying the discovery `nextAction` instead. An unusable route is
worse than an honest refusal: it costs a dispatch, a TaskRun and an operator's
attention before failing.

## 7. Unroutable requirements

`readinessLaneForRole` returns null for `artifact-resolver`,
`delivery-coordinator`, `acceptance-reviewer`, `product-owner` and
`platform-governance`. Today those requirements produce neither a route nor an
escalation — `resolveInitiativeReviewerRecovery` skips them entirely, so
`ARTIFACT_AUTHOR_REQUIRED` disappears from the recovery a blocked Workroom sees.

These roles have no writer tool by design; `ARTIFACT_AUTHOR_REQUIRED`, for
example, is satisfied by the commit carrying a DCO trailer owned by the Workroom
principal, not by anyone recording a receipt. So the fix is not to invent lanes.
Recovery gains a third result list:

```
unroutable: Array<{ accountableRole, code, reason, nextAction }>
```

Each unlaned requirement is reported with the concrete remedy for its code —
for `ARTIFACT_AUTHOR_REQUIRED`, sign the commit off and re-sync the head. A
requirement with no mapped remedy is still listed, with its code, rather than
dropped.

## 8. Security and separation of duties

- No grant expansion. `authorityScope` is per-dispatch and names exactly the
  bound writer plus one immutable reader.
- No self-approval. The existing `independent` exclusion of `currentAgentId` is
  untouched; `record_initiative_evidence` remains `independent: false` because it
  is the author's own evidence, not a review.
- No synthesized bindings. The blob id comes from the provider compare payload
  and is re-verified by `resolveRepositoryArtifact` when the receipt is recorded.
- No readiness bypass. This change only shapes recovery output; it does not
  touch `evaluate.ts`, the gate projection, or any verdict.

## 9. Scale

One compare call per blocked claim that produces at least one lane-backed route,
bounded by GitHub's 300-file compare page. Recovery already performs one grant
query per claim; this adds one provider round trip on the refusal path only,
which is not a hot path.

## 10. Delivery slices and acceptance trace

| Slice | Acceptance evidence |
|---|---|
| Canonical artifact discovery | unit tests for one/zero/many spec matches and provider failure, against a stubbed compare payload |
| Binding minted into the packet | `resolveInitiativeReviewerRecovery` tests asserting both fields, and that `initiativeReviewPacket` accepts the result |
| Escalation when unbindable | test asserting no route and one escalation carrying the remedy |
| Unroutable requirements surfaced | test asserting `ARTIFACT_AUTHOR_REQUIRED` appears in `unroutable` |

## 11. Verification contract

1. Affected Vitest suites for the readiness, tak and mcp adapter modules.
2. `pnpm --filter web build` — TypeScript surfaces only here.
3. No migration; no UI surface, so no UX-fit review. Both classified explicitly.
4. Documentation impact: the MCP authorization runbook describes recovery
   routes and is updated in the same branch.

## 12. Corroborating evidence, and one open ergonomic gap

On `BI-7A38F667` the author recorded `source_verified` evidence at
`2026-08-26T00:17:49Z` (`cmt9chl9i016a01qvyvm3jbbt`) naming the design at
`e5f86ccb...`, and the readiness `factsDigest` stayed byte-identical at
`0d69fc1daf7f...` across it and both later retries.

That is **correct behaviour, not a second defect.** Readiness counts
`initiative_gate_receipt` activities; a plain `evidence` row is a note, not a
governed receipt, and must not move a gate. It is the *symptom* of the defect
fixed here: the author could not reach `record_initiative_evidence` — no grant,
and the recovery route that should have summoned a holder was unexecutable — so
they recorded the nearest thing they could reach instead.

The one genuine gap left is ergonomic: nothing told the author their evidence
would not count. `record_initiative_evidence` is the governed writer, and the
generic evidence tool is silently adjacent to it. Worth a separate item once
this lands and the reachable path is proven; not worth guessing at now.

## 13. Relationship to `BI-329AD58D`

`BI-329AD58D` covers the consumer half — carrying a binding through threadless
`request_coworker` / `summon_coworker` into `mcp-task-submit`, and narrowing the
attached tool surface. That half is already on `main`: `coworker-pack.ts`
declares both fields and `external-coworker-task-adapter.ts` validates and
forwards them. This change is the producer half that half was waiting on, and it
is what makes that item's acceptance criterion 1 — "a readiness recovery packet
passed through threadless request/summon carries an immutable
`initiativeReviewBinding` and exact required tool names" — reachable end to end.

## 14. Terminal-transition recovery extension (`BI-199F71B6`)

The original producer path is incomplete at one lifecycle boundary. It issues
packets only while a Workroom claim is being evaluated for design, plan, or
implementation. A BacklogItem or Workroom completion refusal returns the same
typed readiness decision but does not pass it through
`resolveInitiativeReviewerRecovery`. Consequently,
`ACCEPTANCE_EVIDENCE_REQUIRED` and `OBJECTIVE_RECONCILIATION_REQUIRED` name an
`acceptance-reviewer` that has no executable route, even though the existing
`record_initiative_evidence` writer already accepts an `objective-mapping`
proposal under an exact immutable binding.

### 14.1 Objectives

- **OBJ-PACKET-TERMINAL:** Every governed terminal refusal projects recovery
  from the same readiness decision and server-owned Workroom identity that
  produced the refusal.
- **OBJ-PACKET-MAPPING:** Missing acceptance/objective reconciliation yields an
  executable `record_initiative_evidence` packet whose binding gate is
  `objective-mapping` and whose expected baseline is the current baseline.
- **OBJ-PACKET-UNCHANGED:** Recovery remains additive response data. It changes
  no readiness verdict, terminal mutation, evidence interpretation, reviewer
  grant, or approval rule.

### 14.2 Contract

Add one shared terminal-recovery adapter beside the initiative-readiness
repository. Given a terminal readiness decision, current caller agent, subject
BI, and optional exact Workroom, it:

1. resolves exactly one live Workroom for the BI, or uses the exact Workroom
   whose completion was refused;
2. reads that room's repository, branch, immutable base/head, and the current
   objective-baseline chain head;
3. discovers the provider-verified canonical design blob through the existing
   compare-based discovery helper; and
4. calls the existing `resolveInitiativeReviewerRecovery` registry.

The evidence-writer lane owns `acceptance-reviewer` recovery only for
`ACCEPTANCE_EVIDENCE_REQUIRED` and `OBJECTIVE_RECONCILIATION_REQUIRED`. Those
codes map to recovery gate `objective-mapping`; they do not become receipt gate
keys and cannot write a pass/fail receipt. The packet tells the reviewer to map
every current `OBJ-*` and `AC-*` statement to existing post-baseline evidence
and call `record_initiative_evidence(operation='objective-mapping')`. The
terminal repository remains the only component that evaluates that proposal
and decides completion.

BacklogItem and Workroom MCP adapters attach the resulting `recovery` object to
their existing refusal data. If no unique live Workroom, immutable base/head,
current baseline, canonical artifact, or eligible writer exists, the same
resolver emits its typed escalation; it never fabricates a packet.

### 14.3 Architecture and scale

No table, migration, tool, reviewer role, grant, receipt type, or second
recovery engine is added. One shared adapter composes the canonical Workroom
liveness projection, baseline-chain validator, provider artifact discovery, and
reviewer registry. The terminal refusal path performs a bounded Workroom read,
a bounded baseline-ledger read, one provider compare request, and the existing
bounded grant query. Success paths and non-terminal reads perform none of this
work.

### 14.4 Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-PACKET-TERMINAL-001 | OBJ-PACKET-TERMINAL | Both BacklogItem and Workroom completion refusals return the same executable recovery contract. |
| AC-PACKET-TERMINAL-002 | OBJ-PACKET-MAPPING | The returned packet binds `record_initiative_evidence`, `objective-mapping`, the current baseline, repository/branch/head, canonical design path, and provider blob id. |
| AC-PACKET-TERMINAL-003 | OBJ-PACKET-UNCHANGED | Allowed terminal transitions and all readiness verdicts remain unchanged. |
| AC-PACKET-TERMINAL-004 | OBJ-PACKET-TERMINAL, OBJ-PACKET-UNCHANGED | Missing or ambiguous Workroom/artifact/baseline state returns an actionable typed escalation and no route. |
| AC-PACKET-TERMINAL-005 | OBJ-PACKET-MAPPING | Dispatching the packet can record the existing objective-mapping proposal without caller-constructed authority metadata, and the existing terminal repository alone evaluates it. |

### 14.5 Verification and compatibility

TDD covers acceptance-reviewer routing, packet narrowing, current-baseline
selection, unique/missing Workroom identity, provider-artifact failure, and
both MCP refusal projections. Affected Vitest suites and the production web
build are mandatory. This is an MCP response-contract change with no UI and no
migration; existing clients ignoring the additive `recovery` field are fully
compatible.
